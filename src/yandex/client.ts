/**
 * Reading a library from Yandex Music, through the API its apps use
 * (api.music.yandex.net). It is not public and not documented; the requests
 * here follow the ones the Yandex Music app makes, as written down by the
 * yandex-music-api project (github.com/MarshalX/yandex-music-api).
 *
 * Every answer comes wrapped as { result }. Only the fields crossfade uses
 * are typed below, and every one of them is treated as possibly missing.
 */

import { HttpError, type Requests } from '../requests.ts';

const API = 'https://api.music.yandex.net';
/** The app the token belongs to; some requests are refused without it. */
const CLIENT = 'YandexMusicAndroid/24023621';
/** How many tracks to ask for at once. */
const BATCH = 100;

export interface RawArtist {
  name?: string;
}

export interface RawAlbum {
  id?: number | string;
  title?: string;
  year?: number;
  trackCount?: number;
  artists?: RawArtist[];
}

export interface RawTrack {
  id?: number | string;
  title?: string;
  version?: string;
  artists?: RawArtist[];
  albums?: RawAlbum[];
  durationMs?: number;
  isrc?: string;
  /** "music", "podcast-episode", "audiobook"... */
  type?: string;
  /** For tracks a person uploaded: the artist they typed in. */
  ugcArtistName?: string;
}

/** A track as a like or a playlist refers to it, with the track itself when Yandex includes it. */
export interface TrackRef {
  id?: number | string;
  albumId?: number | string;
  timestamp?: string;
  track?: RawTrack;
}

export interface RawPlaylist {
  kind?: number;
  title?: string;
  description?: string;
  trackCount?: number;
  tracks?: TrackRef[];
}

export interface RawLikedAlbum {
  timestamp?: string;
  album?: RawAlbum;
}

export class YandexAuthError extends Error {
  constructor() {
    super('Yandex Music no longer accepts the saved sign-in. Sign in again: crossfade login yandex-music');
    this.name = 'YandexAuthError';
  }
}

export class YandexMusic {
  readonly #requests: Requests;
  readonly #token: string;

  constructor(requests: Requests, token: string) {
    this.#requests = requests;
    this.#token = token;
  }

  /** Your user id, which the other requests need, and your login. */
  async account(): Promise<{ uid: number; login?: string }> {
    const result = await this.#call<{ account?: { uid?: number; login?: string } }>('GET', '/account/status');
    const uid = result.account?.uid;
    if (typeof uid !== 'number') {
      throw new Error('Yandex Music did not say whose account this is; crossfade may need an update');
    }
    return { uid, login: result.account?.login };
  }

  /** Liked tracks as Yandex lists them: ids and when each was liked, without the tracks. */
  async likedTracks(uid: number): Promise<TrackRef[]> {
    const result = await this.#call<{ library?: { tracks?: TrackRef[] } }>('GET', `/users/${uid}/likes/tracks`);
    return result.library?.tracks ?? [];
  }

  /** The tracks with these ids, BATCH at a time. A track Yandex no longer has is left out. */
  async tracks(ids: string[], onBatch?: (done: number) => void): Promise<RawTrack[]> {
    const tracks: RawTrack[] = [];
    for (let start = 0; start < ids.length; start += BATCH) {
      const batch = ids.slice(start, start + BATCH);
      tracks.push(...(await this.#call<RawTrack[]>('POST', '/tracks', { 'track-ids': batch.join(','), 'with-positions': 'false' })));
      onBatch?.(Math.min(start + BATCH, ids.length));
    }
    return tracks;
  }

  /** Your playlists, without their tracks. */
  async playlists(uid: number): Promise<RawPlaylist[]> {
    return this.#call<RawPlaylist[]>('GET', `/users/${uid}/playlists/list`);
  }

  /** One playlist with its tracks, in order. */
  async playlist(uid: number, kind: number): Promise<RawPlaylist> {
    return this.#call<RawPlaylist>('GET', `/users/${uid}/playlists/${kind}`);
  }

  async likedAlbums(uid: number): Promise<RawLikedAlbum[]> {
    return this.#call<RawLikedAlbum[]>('GET', `/users/${uid}/likes/albums?rich=true`);
  }

  async #call<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
    let response: Response;
    try {
      response = await this.#requests.fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `OAuth ${this.#token}`, 'X-Yandex-Music-Client': CLIENT },
        ...(form ? { body: new URLSearchParams(form) } : {}),
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        throw new YandexAuthError();
      }
      throw error;
    }
    const answer = (await response.json()) as { result?: T };
    if (answer.result === undefined) {
      throw new Error(`Yandex Music answered ${method} ${path.split('?')[0]} without a result; crossfade may need an update`);
    }
    return answer.result;
  }
}
