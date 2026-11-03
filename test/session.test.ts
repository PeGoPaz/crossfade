import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CredentialStore } from '../src/credentials.ts';
import { login } from '../src/login.ts';
import { Requests } from '../src/requests.ts';
import { accountName, authorization, parseHeaders, sapisid, sessionHeaders } from '../src/ytmusic/session.ts';

// Made-up values in the shape of a real session.
const COOKIE = 'VISITOR_INFO1_LIVE=v1s1t0r; SAPISID=old-sapisid; __Secure-3PAPISID=abc123/XYZ; SID=s1d';

const FIREFOX = `POST /youtubei/v1/browse?prettyPrint=false HTTP/2
Host: music.youtube.com
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0
Accept: */*
Content-Type: application/json
X-Goog-AuthUser: 1
Origin: https://music.youtube.com
Cookie: ${COOKIE}`;

const CHROME = `:authority: music.youtube.com
:method: POST
cookie: ${COOKIE}
x-goog-authuser: 0`;

const CURL = `curl 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false' -X POST -H 'Content-Type: application/json' -H 'Cookie: ${COOKIE}' -H "X-Goog-AuthUser: 2" --data-raw '{}'`;

const SIGNED_IN = {
  actions: [
    {
      openPopupAction: {
        popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: { runs: [{ text: 'Vladimir' }] } } } } },
      },
    },
  ],
};
const SIGNED_OUT = { actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { sections: [] } } } }] };

describe('YouTube Music session', () => {
  test('headers copied from Firefox', () => {
    assert.deepEqual(parseHeaders(FIREFOX), {
      cookie: COOKIE,
      authUser: '1',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
    });
  });

  test('headers copied from Chrome, with its pseudo-headers', () => {
    assert.deepEqual(parseHeaders(CHROME), { cookie: COOKIE, authUser: '0' });
  });

  test('a request copied as cURL', () => {
    assert.deepEqual(parseHeaders(CURL), { cookie: COOKIE, authUser: '2' });
  });

  test('headers without the sign-in cookie', () => {
    assert.throws(() => parseHeaders('Host: music.youtube.com\nCookie: VISITOR_INFO1_LIVE=v1s1t0r'), /no YouTube sign-in cookie/);
    assert.throws(() => parseHeaders('Host: music.youtube.com'), /no YouTube sign-in cookie/);
  });

  test('the newer SAPISID cookie is preferred to the old one', () => {
    assert.equal(sapisid(COOKIE), 'abc123/XYZ');
    assert.equal(sapisid('SAPISID=only-old'), 'only-old');
    assert.equal(sapisid('SID=s1d'), undefined);
  });

  test('the Authorization header is the SAPISIDHASH the site would send', async () => {
    // Computed separately: sha1("1700000000 abc123/XYZ https://music.youtube.com").
    assert.equal(
      await authorization({ cookie: COOKIE, authUser: '0' }, 1_700_000_000_999),
      'SAPISIDHASH 1700000000_289fd730e8d0d6300b332703c750af560713e6b1',
    );
  });

  test('requests made as you carry the cookie, the hash and the account number', async () => {
    const headers = await sessionHeaders({ cookie: COOKIE, authUser: '1' }, 1_700_000_000_000);
    assert.equal(headers.Cookie, COOKIE);
    assert.match(headers.Authorization ?? '', /^SAPISIDHASH 1700000000_[0-9a-f]{40}$/);
    assert.equal(headers['X-Goog-AuthUser'], '1');
    assert.equal(headers.Origin, 'https://music.youtube.com');
    assert.equal(headers['User-Agent'], undefined);
  });

  test('the account name tells a signed-in session from one that is not', async () => {
    const requests = (answer: object) => new Requests({ spacingMs: 0, fetch: async () => Response.json(answer) });
    const session = { cookie: COOKIE, authUser: '0' };
    assert.equal(await accountName(requests(SIGNED_IN), session, () => 0), 'Vladimir');
    await assert.rejects(accountName(requests(SIGNED_OUT), session, () => 0), /does not take these headers as signed in/);
  });
});

describe('crossfade login youtube-music', () => {
  async function run(pasted: string, answer: object, t: { after: (fn: () => Promise<void>) => void }) {
    const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const store = new CredentialStore(base);
    const sent: Headers[] = [];
    const fetch = async (_: string | URL | Request, init?: RequestInit) => {
      sent.push(new Headers(init?.headers));
      return Response.json(answer);
    };
    const out: string[] = [];
    const err: string[] = [];
    const code = await login(
      'youtube-music',
      { out: s => out.push(s), err: s => err.push(s) },
      { store, clock: { now: () => 1_700_000_000_000, sleep: async () => {} }, fetch },
      async () => pasted,
    );
    return { code, out, err, store, sent };
  }

  test('checks the pasted headers with YouTube Music, then keeps the session', async t => {
    const { code, out, store, sent } = await run(FIREFOX, SIGNED_IN, t);
    assert.equal(code, 0);
    assert.deepEqual(out, [`Signed in to YouTube Music as Vladimir. crossfade keeps the cookie in ${store.path('youtube-music')}`]);
    assert.deepEqual(await store.load('youtube-music'), parseHeaders(FIREFOX));
    assert.equal(sent[0]?.get('cookie'), COOKIE);
  });

  test('headers YouTube Music does not take are not kept', async t => {
    const { code, err, store } = await run(FIREFOX, SIGNED_OUT, t);
    assert.equal(code, 1);
    assert.match(err.at(-1) ?? '', /does not take these headers as signed in/);
    assert.equal(await store.load('youtube-music'), undefined);
  });

  test('pasting something else says what is missing', async t => {
    const { code, err, sent } = await run('hello', SIGNED_IN, t);
    assert.equal(code, 1);
    assert.match(err.at(-1) ?? '', /no YouTube sign-in cookie/);
    assert.equal(sent.length, 0);
  });

  test('the instructions warn where the headers must not go', async t => {
    const { err } = await run(FIREFOX, SIGNED_IN, t);
    assert.match(err.join('\n'), /never into a chat or an issue/);
  });
});
