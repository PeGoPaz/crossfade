/**
 * Yandex Music as a set of answers by path, for the tests of the reader and
 * of the export command.
 */

import { Requests } from '../src/requests.ts';
import { type RawTrack, YandexMusic } from '../src/yandex/client.ts';

// Shaped after the answers of api.music.yandex.net as the yandex-music-api
// project describes them. To be replaced by recorded answers once a real
// export has been made.

export const queen: RawTrack = {
  id: 101,
  title: 'Bohemian Rhapsody',
  version: 'Remastered 2011',
  artists: [{ name: 'Queen' }],
  albums: [{ id: 11, title: 'A Night At The Opera', year: 1975 }],
  durationMs: 354000,
  isrc: 'gb-um7-10-29604',
  type: 'music',
};
export const kino: RawTrack = {
  id: 102,
  title: 'Группа крови',
  artists: [{ name: 'Кино' }],
  albums: [{ id: 12, title: 'Группа крови', year: 1988 }],
  durationMs: 286000,
  type: 'music',
};
export const podcast: RawTrack = { id: 103, title: 'Выпуск 12', artists: [], type: 'podcast-episode', durationMs: 3600000 };
export const upload: RawTrack = { id: 'a1b2c3', title: 'Демо', artists: [], ugcArtistName: 'Мой друг', durationMs: 180000 };

export interface Call {
  method: string;
  path: string;
  form: Record<string, string>;
  headers: Headers;
}

/** Yandex Music as a set of answers by path; unknown paths are a 404. */
export function fakeYandex(routes: Record<string, unknown | ((call: Call) => unknown)>, status = 200) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const { pathname, search } = new URL(String(url));
    const call = {
      method: init?.method ?? 'GET',
      path: pathname + search,
      form: Object.fromEntries(new URLSearchParams(init?.body ? String(init.body) : '')),
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const route = routes[call.path];
    if (status !== 200) return Response.json({ error: { name: 'session-expired' } }, { status });
    if (route === undefined) return Response.json({ error: { name: 'not-found' } }, { status: 404 });
    return Response.json({ invocationInfo: {}, result: typeof route === 'function' ? route(call) : route });
  };
  const client = new YandexMusic(new Requests({ spacingMs: 0, retries: 0, fetch }), 'y0_made-up-token');
  return { client, calls, fetch };
}

/** POST /tracks: the asked-for tracks this set knows, in the order asked. */
export function tracksFrom(...tracks: RawTrack[]) {
  return (call: Call) =>
    call.form['track-ids']!.split(',')
      .map(id => tracks.find(track => String(track.id) === id.split(':')[0]))
      .filter(Boolean);
}

export const LIBRARY = {
  '/account/status': { account: { uid: 42, login: 'vladimir' } },
  '/users/42/likes/tracks': {
    library: {
      uid: 42,
      revision: 7,
      tracks: [
        { id: '101', albumId: '11', timestamp: '2024-05-01T10:00:00+00:00' },
        { id: '103', albumId: '13', timestamp: '2024-04-01T10:00:00+00:00' },
        { id: '102', albumId: '12', timestamp: '2023-01-15T08:30:00+03:00' },
      ],
    },
  },
  '/tracks': tracksFrom(queen, kino, podcast, upload),
  '/users/42/playlists/list': [{ kind: 1003, title: 'Дорога', trackCount: 3 }],
  '/users/42/playlists/1003': {
    kind: 1003,
    title: 'Дорога',
    description: '',
    tracks: [
      { id: 102, timestamp: '2024-01-01T00:00:00+00:00', track: kino },
      { id: 'a1b2c3', timestamp: '2024-01-02T00:00:00+00:00' },
      { id: 102, timestamp: '2024-01-03T00:00:00+00:00', track: kino },
    ],
  },
  '/users/42/likes/albums?rich=true': [
    { timestamp: '2024-02-02T12:00:00+00:00', album: { id: 12, title: 'Группа крови', year: 1988, trackCount: 11, artists: [{ name: 'Кино' }] } },
  ],
};

