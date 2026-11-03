import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Requests } from '../src/requests.ts';
import { YandexAuthError, YandexMusic } from '../src/yandex/client.ts';
import { readLibrary } from '../src/yandex/library.ts';
import { LIBRARY, fakeYandex as yandex, kino, podcast, tracksFrom, upload } from './fake-yandex.ts';

const now = () => Date.parse('2026-11-03T13:30:00Z');

describe('reading a Yandex Music library', () => {
  test('liked tracks, playlists and liked albums, in the library format', async () => {
    const { client } = yandex(LIBRARY);
    const { library, notMusic, gone } = await readLibrary(client, now);
    assert.deepEqual(library, {
      format: 'crossfade-library',
      version: 1,
      source: 'yandex-music',
      exportedAt: '2026-11-03T13:30:00.000Z',
      tracks: [
        {
          id: '101',
          title: 'Bohemian Rhapsody',
          version: 'Remastered 2011',
          artists: ['Queen'],
          album: 'A Night At The Opera',
          year: 1975,
          durationMs: 354000,
          isrc: 'GBUM71029604',
        },
        { id: '102', title: 'Группа крови', artists: ['Кино'], album: 'Группа крови', year: 1988, durationMs: 286000 },
        { id: 'a1b2c3', title: 'Демо', artists: ['Мой друг'], durationMs: 180000 },
      ],
      liked: [
        { track: '101', likedAt: '2024-05-01T10:00:00.000Z' },
        { track: '102', likedAt: '2023-01-15T05:30:00.000Z' },
      ],
      playlists: [{ id: '1003', title: 'Дорога', tracks: ['102', 'a1b2c3', '102'] }],
      albums: [{ id: '12', title: 'Группа крови', artists: ['Кино'], year: 1988, trackCount: 11, likedAt: '2024-02-02T12:00:00.000Z' }],
    });
    assert.deepEqual(notMusic, ['103']);
    assert.deepEqual(gone, []);
  });

  test('asks only for tracks a playlist did not include, as track:album', async () => {
    const { client, calls } = yandex(LIBRARY);
    await readLibrary(client, now);
    const asked = calls.filter(call => call.path === '/tracks').map(call => call.form['track-ids']);
    assert.deepEqual(asked, ['101:11,103:13,a1b2c3']);
  });

  test('a track Yandex no longer gives is left out and reported', async () => {
    const { client } = yandex({ ...LIBRARY, '/tracks': tracksFrom(kino, podcast, upload) });
    const { library, gone } = await readLibrary(client, now);
    assert.deepEqual(gone, ['101']);
    assert.deepEqual(library.liked.map(like => like.track), ['102']);
  });

  test('tracks are asked for a hundred at a time', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, title: `Track ${i}`, artists: [{ name: 'A' }] }));
    const { client, calls } = yandex({
      ...LIBRARY,
      '/users/42/likes/tracks': { library: { tracks: many.map(track => ({ id: String(track.id) })) } },
      '/tracks': tracksFrom(...many),
      '/users/42/playlists/list': [],
      '/users/42/likes/albums?rich=true': [],
    });
    const progress: string[] = [];
    const { library } = await readLibrary(client, now, message => progress.push(message));
    const sizes = calls.filter(call => call.path === '/tracks').map(call => call.form['track-ids']!.split(',').length);
    assert.deepEqual(sizes, [100, 100, 50]);
    assert.equal(library.liked.length, 250);
    assert.deepEqual(progress.slice(-3), ['tracks 100 of 250', 'tracks 200 of 250', 'tracks 250 of 250']);
  });

  test('every request carries the token and the app it belongs to', async () => {
    const { client, calls } = yandex(LIBRARY);
    await readLibrary(client, now);
    for (const call of calls) {
      assert.equal(call.headers.get('authorization'), 'OAuth y0_made-up-token');
      assert.match(call.headers.get('x-yandex-music-client') ?? '', /^YandexMusicAndroid\//);
    }
  });

  test('a token Yandex no longer accepts asks to sign in again', async () => {
    const { client } = yandex(LIBRARY, 401);
    await assert.rejects(readLibrary(client, now), YandexAuthError);
    await assert.rejects(client.account(), { message: /Sign in again: crossfade login yandex-music$/ });
  });

  test('an answer without a result means Yandex has changed', async () => {
    const fetch = async () => Response.json({ invocationInfo: {} });
    const client = new YandexMusic(new Requests({ spacingMs: 0, fetch }), 't');
    await assert.rejects(client.account(), /without a result; crossfade may need an update/);
  });

  test('an untitled playlist and a liked album without a title', async () => {
    const { client } = yandex({
      ...LIBRARY,
      '/users/42/playlists/1003': { kind: 1003, title: '  ', tracks: [] },
      '/users/42/likes/albums?rich=true': [{ album: { id: 5 } }],
    });
    const { library } = await readLibrary(client, now);
    assert.deepEqual(library.playlists, [{ id: '1003', title: 'Playlist 1003', tracks: [] }]);
    assert.deepEqual(library.albums, []);
  });
});
