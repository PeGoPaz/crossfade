/**
 * Changing your YouTube Music library: liking songs, making playlists and
 * adding songs to them, through the same requests the site makes when you
 * click. The request bodies follow ytmusicapi.
 *
 * Playlists are made private. Songs go into a playlist a hundred at a time:
 * the site adds them a few at a time, and a smaller request is more likely
 * to be taken whole.
 */

import type { Requests } from '../requests.ts';
import { context } from './search.ts';
import { ORIGIN, type YouTubeSession, sessionHeaders } from './session.ts';

const BATCH = 100;

export class YouTubeWriter {
  readonly #requests: Requests;
  readonly #session: YouTubeSession;
  readonly #now: () => number;

  constructor(requests: Requests, session: YouTubeSession, now: () => number = Date.now) {
    this.#requests = requests;
    this.#session = session;
    this.#now = now;
  }

  async like(videoId: string): Promise<void> {
    await this.#post('like/like', { target: { videoId } });
  }

  /** Makes a private playlist with these songs and returns its id. */
  async createPlaylist(title: string, description: string, videoIds: string[]): Promise<string> {
    const answer = (await this.#post('playlist/create', {
      // The site breaks on these in a title.
      title: title.replace(/[<>]/g, ''),
      description: description.replace(/[<>]/g, ''),
      privacyStatus: 'PRIVATE',
      videoIds: videoIds.slice(0, BATCH),
    })) as { playlistId?: string };
    if (!answer.playlistId) {
      throw new Error(`YouTube Music did not make the playlist "${title}"`);
    }
    await this.addToPlaylist(answer.playlistId, videoIds.slice(BATCH));
    return answer.playlistId;
  }

  /** Adds songs to the end of a playlist; a song it has already is skipped by YouTube Music itself. */
  async addToPlaylist(playlistId: string, videoIds: string[]): Promise<void> {
    for (let start = 0; start < videoIds.length; start += BATCH) {
      const actions = videoIds
        .slice(start, start + BATCH)
        .map(videoId => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }));
      const answer = (await this.#post('browse/edit_playlist', { playlistId, actions })) as { status?: string };
      if (!answer.status?.includes('SUCCEEDED')) {
        throw new Error(`YouTube Music did not add the songs to the playlist ${playlistId}: ${answer.status ?? 'no status'}`);
      }
    }
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.#post('playlist/delete', { playlistId });
  }

  async #post(endpoint: string, body: object): Promise<unknown> {
    const response = await this.#requests.fetch(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers: await sessionHeaders(this.#session, this.#now()),
      body: JSON.stringify({ context: context(this.#now()), ...body }),
    });
    return response.json();
  }
}
