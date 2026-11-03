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

// The parts of the answer that are read, every one possibly missing.
interface Run {
  text?: string;
  navigationEndpoint?: {
    browseEndpoint?: { browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } } };
  };
}
interface Row {
  musicResponsiveListItemRenderer?: {
    flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: Run[] } } }[];
    playlistItemData?: { videoId?: string };
  };
}
interface Answer {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs?: { tabRenderer?: { content?: { sectionListRenderer?: { contents?: { musicShelfRenderer?: { contents?: Row[] } }[] } } } }[];
    };
  };
}

/**
 * Pages a run of text can link to. A video's channel links to a channel
 * page; when no run links to an artist, the text before the first " • "
 * is taken instead, which is that channel's name.
 */
const ARTIST_PAGE = 'MUSIC_PAGE_TYPE_ARTIST';
const ALBUM_PAGE = 'MUSIC_PAGE_TYPE_ALBUM';
const DURATION = /^(\d+):(\d{2})(?::(\d{2}))?$/;

/** The result rows of a search answer as candidates. Rows without a video id cannot be liked, so they are left out. */
export function parseSearch(answer: unknown, kind: 'song' | 'video'): Candidate[] {
  const tabs = (answer as Answer).contents?.tabbedSearchResultsRenderer?.tabs;
  if (!tabs) {
    throw new Error('YouTube Music answered the search in an unexpected way; crossfade may need an update');
  }
  const sections = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
  const rows = sections.flatMap(section => section.musicShelfRenderer?.contents ?? []);
  return rows.flatMap(row => {
    const item = row.musicResponsiveListItemRenderer;
    const id = item?.playlistItemData?.videoId;
    const [titleColumn, detailColumn] = (item?.flexColumns ?? []).map(
      column => column.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [],
    );
    const title = text(titleColumn ?? []);
    if (!id || !title) return [];

    // "Artist & Artist • Album • 4:45" for songs, "Channel • 25M views • 4:51" for videos.
    const details = detailColumn ?? [];
    const linked = (page: (type: string) => boolean) => details.filter(run => page(pageType(run))).map(run => run.text ?? '');
    const artists = linked(type => type === ARTIST_PAGE);
    const album = linked(type => type === ALBUM_PAGE)[0];
    const durationMs = milliseconds(details.at(-1)?.text);
    return [
      {
        id,
        title,
        artists: artists.length > 0 ? artists : unlinkedArtists(details),
        ...(album ? { album } : {}),
        ...(durationMs ? { durationMs } : {}),
        kind,
      },
    ];
  });
}

function text(runs: Run[]): string {
  return runs.map(run => run.text ?? '').join('').trim();
}

function pageType(run: Run): string {
  return run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
}

/** When no artist is linked, the text before the first " • " names them. */
function unlinkedArtists(details: Run[]): string[] {
  const first = text(details).split(' • ')[0]?.trim();
  return first ? [first] : [];
}

function milliseconds(value: string | undefined): number | undefined {
  const match = value && DURATION.exec(value.trim());
  if (!match) return undefined;
  // m:ss, or h:mm:ss for long ones.
  const [, first, second, third] = match;
  const seconds = third === undefined ? Number(first) * 60 + Number(second) : Number(first) * 3600 + Number(second) * 60 + Number(third);
  return seconds * 1000;
}
