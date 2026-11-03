import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CredentialStore } from '../src/credentials.ts';
import { login } from '../src/login.ts';
import { Requests } from '../src/requests.ts';
import { requestCode, waitForToken } from '../src/yandex/signin.ts';

// The shapes Yandex answered with on 3 November 2026, with made-up values.
const CODE = {
  device_code: 'd0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0',
  user_code: 'abcd1234',
  verification_url: 'https://ya.ru/device',
  interval: 5,
  expires_in: 300,
};
const PENDING = [400, { error: 'authorization_pending', error_description: 'User has not yet authorized your application' }] as const;
const TOKEN = [200, { access_token: 'y0_made-up-token', expires_in: 31536000, token_type: 'bearer' }] as const;

/**
 * Yandex as a script: the code request is answered with CODE, and each
 * check for the token with the next answer given. Time moves only when
 * crossfade waits.
 */
function yandex(answers: (readonly [number, object])[]) {
  let now = 0;
  const waits: number[] = [];
  const bodies: Record<string, string>[] = [];
  const clock = {
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
  };
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    bodies.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
    const [status, body] = String(url).endsWith('/device/code') ? [200, CODE] : (answers.shift() ?? PENDING);
    return Response.json(body, { status });
  };
  return { clock, fetch, waits, bodies, requests: new Requests({ spacingMs: 0, fetch, clock }) };
}

describe('signing in to Yandex Music', () => {
  test('a code to enter, and how long it works', async () => {
    const { requests, clock, bodies } = yandex([]);
    assert.deepEqual(await requestCode(requests, clock, () => 'device0001'), {
      userCode: 'abcd1234',
      verificationUrl: 'https://ya.ru/device',
      deviceCode: CODE.device_code,
      intervalMs: 5000,
      expiresAt: 300_000,
    });
    assert.deepEqual(bodies[0], { client_id: '23cabbbdc6cd418abb4b39c32c41195d', device_id: 'device0001', device_name: 'crossfade' });
  });

  test('asks as often as Yandex allows until the code is entered', async () => {
    const { requests, clock, waits, bodies } = yandex([PENDING, PENDING, TOKEN]);
    const code = await requestCode(requests, clock);
    assert.deepEqual(await waitForToken(requests, clock, code), { token: 'y0_made-up-token', expiresAt: 15_000 + 31_536_000_000 });
    assert.deepEqual(waits, [5000, 5000, 5000]);
    assert.equal(bodies[1]?.grant_type, 'device_code');
    assert.equal(bodies[1]?.code, CODE.device_code);
  });

  test('waits longer when Yandex says to slow down', async () => {
    const { requests, clock, waits } = yandex([[400, { error: 'slow_down' }], TOKEN]);
    await waitForToken(requests, clock, await requestCode(requests, clock));
    assert.deepEqual(waits, [5000, 10_000]);
  });

  test('stops when the code expires', async () => {
    const { requests, clock, waits } = yandex([]);
    await assert.rejects(waitForToken(requests, clock, await requestCode(requests, clock)), {
      message: 'The code expired before it was entered. Run "crossfade login yandex-music" again.',
    });
    assert.equal(waits.length, 60);
  });

  test('Yandex says the code has expired', async () => {
    const { requests, clock } = yandex([[400, { error: 'invalid_grant', error_description: 'Code has expired' }]]);
    await assert.rejects(waitForToken(requests, clock, await requestCode(requests, clock)), /The code expired/);
  });

  test('the sign-in was declined', async () => {
    const { requests, clock } = yandex([[400, { error: 'access_denied' }]]);
    await assert.rejects(waitForToken(requests, clock, await requestCode(requests, clock)), {
      message: 'The sign-in was declined on the Yandex page.',
    });
  });

  test('an answer crossfade does not know is reported as Yandex put it', async () => {
    const { requests, clock } = yandex([[400, { error: 'invalid_client', error_description: 'Client not found' }]]);
    await assert.rejects(waitForToken(requests, clock, await requestCode(requests, clock)), {
      message: 'Yandex refused the sign-in: Client not found',
    });
  });

  test('a token in another shape means Yandex has changed', async () => {
    const { requests, clock } = yandex([[200, { token: 'y0_made-up-token' }]]);
    await assert.rejects(waitForToken(requests, clock, await requestCode(requests, clock)), /crossfade may need an update/);
  });
});

describe('crossfade login yandex-music', () => {
  async function run(answers: (readonly [number, object])[], t: { after: (fn: () => Promise<void>) => void }) {
    const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const store = new CredentialStore(base);
    const { clock, fetch } = yandex(answers);
    const out: string[] = [];
    const err: string[] = [];
    const code = await login('yandex-music', { out: s => out.push(s), err: s => err.push(s) }, { store, clock, fetch });
    return { code, out, err, store };
  }

  test('shows the code, waits, and keeps the token', async t => {
    const { code, out, err, store } = await run([PENDING, TOKEN], t);
    assert.equal(code, 0);
    assert.deepEqual(err, []);
    assert.deepEqual(out, [
      'Open https://ya.ru/device where you are signed in to Yandex, and enter the code abcd1234',
      'The code works for 5 min. Waiting...',
      `Signed in to Yandex Music. crossfade keeps the token in ${store.path('yandex-music')}`,
    ]);
    assert.deepEqual(await store.load('yandex-music'), { token: 'y0_made-up-token', expiresAt: 10_000 + 31_536_000_000 });
  });

  test('a declined sign-in is an error and saves nothing', async t => {
    const { code, err, store } = await run([[400, { error: 'access_denied' }]], t);
    assert.equal(code, 1);
    assert.deepEqual(err, ['The sign-in was declined on the Yandex page.']);
    assert.equal(await store.load('yandex-music'), undefined);
  });

  test('YouTube Music is not written yet', async () => {
    const err: string[] = [];
    assert.equal(await login('youtube-music', { out: () => {}, err: s => err.push(s) }), 1);
    assert.match(err[0] ?? '', /not written yet/);
  });
});
