import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Requests } from '../src/requests.ts';
import { YouTubeWriter } from '../src/ytmusic/write.ts';

interface Sent {
  endpoint: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** YouTube Music taking every change, answering by endpoint, and keeping what it was sent. */
function youtube(answers: Record<string, object> = {}) {
  const sent: Sent[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const endpoint = new URL(String(url)).pathname.replace('/youtubei/v1/', '');
    sent.push({ endpoint, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return Response.json(answers[endpoint] ?? { status: 'STATUS_SUCCEEDED', playlistId: 'PLnew' });
  };
  const session = { cookie: 'SID=s; __Secure-3PAPISID=abc123/XYZ', authUser: '0' };
  const writer = new YouTubeWriter(new Requests({ spacingMs: 0, fetch }), session, () => 1_700_000_000_000);
  const bodies = () => sent.map(({ endpoint, body }) => {
    const { context, ...rest } = body;
    return [endpoint, rest];
  });
  return { writer, sent, bodies };
}

const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `v${from + i}`);

describe('changing the YouTube Music library', () => {
  test('a like, made as you', async () => {
    const { writer, sent, bodies } = youtube();
    await writer.like('xtxjm7ciwmc');
    assert.deepEqual(bodies(), [['like/like', { target: { videoId: 'xtxjm7ciwmc' } }]]);
    assert.match(sent[0]?.headers.get('authorization') ?? '', /^SAPISIDHASH /);
    assert.equal((sent[0]?.body.context as { client: { clientName: string } }).client.clientName, 'WEB_REMIX');
  });

  test('a private playlist, made with its first hundred songs, the rest added after', async () => {
    const { writer, bodies } = youtube();
    assert.equal(await writer.createPlaylist('Дорога <в машину>', 'Из Яндекс Музыки', ids(0, 250)), 'PLnew');
    const sent = bodies();
    assert.deepEqual(sent[0], ['playlist/create', { title: 'Дорога в машину', description: 'Из Яндекс Музыки', privacyStatus: 'PRIVATE', videoIds: ids(0, 100) }]);
    assert.deepEqual(
      sent.slice(1).map(([endpoint, body]) => [endpoint, (body as { actions: unknown[] }).actions.length]),
      [['browse/edit_playlist', 100], ['browse/edit_playlist', 50]],
    );
  });

  test('songs added to a playlist skip the ones it has', async () => {
    const { writer, bodies } = youtube();
    await writer.addToPlaylist('PLsport', ['k1', 'q1']);
    assert.deepEqual(bodies(), [
      [
        'browse/edit_playlist',
        {
          playlistId: 'PLsport',
          actions: [
            { action: 'ACTION_ADD_VIDEO', addedVideoId: 'k1', dedupeOption: 'DEDUPE_OPTION_SKIP' },
            { action: 'ACTION_ADD_VIDEO', addedVideoId: 'q1', dedupeOption: 'DEDUPE_OPTION_SKIP' },
          ],
        },
      ],
    ]);
  });

  test('nothing to add sends nothing', async () => {
    const { writer, sent } = youtube();
    await writer.addToPlaylist('PLsport', []);
    assert.deepEqual(sent, []);
  });

  test('a playlist that was not made, or songs that were not added, are errors', async () => {
    await assert.rejects(youtube({ 'playlist/create': {} }).writer.createPlaylist('Дорога', '', ['k1']), /did not make the playlist "Дорога"/);
    await assert.rejects(
      youtube({ 'browse/edit_playlist': { status: 'STATUS_FAILED' } }).writer.addToPlaylist('PLsport', ['k1']),
      /did not add the songs to the playlist PLsport: STATUS_FAILED/,
    );
  });

  test('deleting a playlist', async () => {
    const { writer, bodies } = youtube();
    await writer.deletePlaylist('PLnew');
    assert.deepEqual(bodies(), [['playlist/delete', { playlistId: 'PLnew' }]]);
  });
});
