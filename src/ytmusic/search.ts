/**
 * Searching YouTube Music the way its website does: a POST to its internal
 * API (youtubei/v1, which YouTube calls InnerTube) as the web client, with
 * the same filters the site's Songs and Videos tabs use. The answer is the
 * page's layout as data; only the rows of the result list are read here.
 *
 * Searching needs no account. The request shapes follow the ytmusicapi
 * project (github.com/sigma67/ytmusicapi).
 */

import type { Requests } from '../requests.ts';
import type { Candidate } from '../score.ts';
import { type Row, parseRow } from './rows.ts';

const API = 'https://music.youtube.com/youtubei/v1';

/** The filters behind the Songs and Videos tabs of the search page. */
const FILTERS = {
  song: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  video: 'EgWKAQIQAWoMEA4QChADEAQQCRAF',
};

/** Who is asking: the web client, versioned by date like the site, in English so labels read the same. */
export function context(now: number) {
  const date = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  return { client: { clientName: 'WEB_REMIX', clientVersion: `1.${date}.01.00`, hl: 'en' } };
}

export class YouTubeMusic {
  readonly #requests: Requests;
  readonly #now: () => number;

  constructor(requests: Requests, now: () => number = Date.now) {
    this.#requests = requests;
    this.#now = now;
  }

  /** The first page of results for a query, among songs or among videos. */
  async search(query: string, kind: keyof typeof FILTERS = 'song'): Promise<Candidate[]> {
    const response = await this.#requests.fetch(`${API}/search?prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: context(this.#now()), query, params: FILTERS[kind] }),
    });
    return parseSearch(await response.json(), kind);
  }
}

interface Answer {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs?: { tabRenderer?: { content?: { sectionListRenderer?: { contents?: { musicShelfRenderer?: { contents?: Row[] } }[] } } } }[];
    };
  };
}

/** The result rows of a search answer as candidates. Rows without a video id cannot be liked, so they are left out. */
export function parseSearch(answer: unknown, kind: 'song' | 'video'): Candidate[] {
  const tabs = (answer as Answer).contents?.tabbedSearchResultsRenderer?.tabs;
  if (!tabs) {
    throw new Error('YouTube Music answered the search in an unexpected way; crossfade may need an update');
  }
  const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  return sections.flatMap(section => section.musicShelfRenderer?.contents ?? []).flatMap(row => parseRow(row, kind) ?? []);
}
