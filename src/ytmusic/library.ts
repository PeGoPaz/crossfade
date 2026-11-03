/**
 * What is already in your YouTube Music library - liked songs, playlists
 * and saved albums - so that crossfade adds nothing twice.
 *
 * Lists come a page at a time. Playlist pages end with a token for the next
 * page; the library's grids of playlists and albums may still use the
 * older kind, where the token sits beside the list and goes into the query.
 * Both are followed until there is no next page.
 */

import type { Requests } from '../requests.ts';
import type { Candidate } from '../score.ts';
import { type Row, type Run, parseRow, text } from './rows.ts';
import { context } from './search.ts';
import { ORIGIN, type YouTubeSession, sessionHeaders } from './session.ts';

export interface OwnedPlaylist {
  /** The playlist id, without the "VL" its page adds. */
  id: string;
  title: string;
}

export interface SavedAlbum {
  /** The album page's id, MPRE... */
  id: string;
  title: string;
  artists: string[];
  year?: number;
}

export interface YouTubeLibraryContents {
  liked: Candidate[];
  playlists: (OwnedPlaylist & { items: Candidate[] })[];
  albums: SavedAlbum[];
}

/** Lists the library shows that are not playlists of yours: liked music, read on its own, and episodes saved for later. */
const NOT_PLAYLISTS = new Set(['LM', 'SE']);
/** A guard against a list that hands back the same page forever. */
const MAX_PAGES = 500;

export class YouTubeLibrary {
  readonly #requests: Requests;
  readonly #session: YouTubeSession;
  readonly #now: () => number;

  constructor(requests: Requests, session: YouTubeSession, now: () => number = Date.now) {
    this.#requests = requests;
    this.#session = session;
    this.#now = now;
  }

  /** Your liked songs, which YouTube Music keeps as the playlist LM. */
  likedSongs(): Promise<Candidate[]> {
    return this.playlist('LM');
  }

  async playlist(id: string): Promise<Candidate[]> {
    const rows = await this.#all(`VL${id}`, 'musicPlaylistShelfRenderer');
    return rows.flatMap(row => parseRow(row as Row) ?? []);
  }

  async playlists(): Promise<OwnedPlaylist[]> {
    const items = await this.#all('FEmusic_liked_playlists', 'gridRenderer');
    return items.flatMap(item => {
      const { title, browseId } = tile(item);
      const id = browseId?.startsWith('VL') ? browseId.slice(2) : undefined;
      // The first tile is the "New playlist" button, which links nowhere.
      return id && title && !NOT_PLAYLISTS.has(id) ? [{ id, title }] : [];
    });
  }

  async albums(): Promise<SavedAlbum[]> {
    const items = await this.#all('FEmusic_liked_albums', 'gridRenderer');
    return items.flatMap(item => {
      const { title, browseId, subtitle } = tile(item);
      if (!title || !browseId) return [];
      // "Album • Кино • 1988": the kind of release, the artists, the year.
      const parts = text(subtitle).split(' • ');
      const year = Number(parts.at(-1));
      const linked = subtitle.filter(run => run.navigationEndpoint?.browseEndpoint).map(run => run.text ?? '');
      const artists = linked.length > 0 ? linked : parts.slice(1, Number.isInteger(year) ? -1 : undefined);
      return [{ id: browseId, title, artists: artists.filter(Boolean), ...(Number.isInteger(year) && year > 0 ? { year } : {}) }];
    });
  }

  /** Every item of a list, page after page. */
  async #all(browseId: string, renderer: string): Promise<unknown[]> {
    let page = firstPage(await this.#browse({ browseId }), renderer);
    const items = [...page.items];
    const seen = new Set<string>();
    while (page.next && !seen.has(page.next) && seen.size < MAX_PAGES) {
      seen.add(page.next);
      page = nextPage(await this.#browse(page.old ? {} : { continuation: page.next }, page.old ? page.next : undefined));
      items.push(...page.items);
    }
    return items;
  }

  async #browse(body: object, oldToken?: string): Promise<unknown> {
    const query = oldToken ? `&ctoken=${encodeURIComponent(oldToken)}&continuation=${encodeURIComponent(oldToken)}&type=next` : '';
    const response = await this.#requests.fetch(`${ORIGIN}/youtubei/v1/browse?prettyPrint=false${query}`, {
      method: 'POST',
      headers: await sessionHeaders(this.#session, this.#now()),
      body: JSON.stringify({ context: context(this.#now()), ...body }),
    });
    return response.json();
  }
}

/** Reads the whole library, saying how far it got. */
export async function readYouTubeLibrary(
  library: YouTubeLibrary,
  progress: (message: string) => void = () => {},
): Promise<YouTubeLibraryContents> {
  const liked = await library.likedSongs();
  progress(`${liked.length} liked songs`);
  const playlists = [];
  const owned = await library.playlists();
  for (const playlist of owned) {
    playlists.push({ ...playlist, items: await library.playlist(playlist.id) });
    progress(`playlist ${playlists.length} of ${owned.length}`);
  }
  const albums = await library.albums();
  progress(`${albums.length} saved albums`);
  return { liked, playlists, albums };
}

interface Page {
  items: unknown[];
  /** The token for the next page, if there is one. */
  next?: string;
  /** Whether it is the older kind of token, sent in the query rather than the body. */
  old?: boolean;
}

interface Renderer {
  contents?: unknown[];
  items?: unknown[];
  continuations?: { nextContinuationData?: { continuation?: string } }[];
}

function firstPage(answer: unknown, renderer: string): Page {
  const found = find(answer, renderer) as Renderer | undefined;
  if (!found) {
    // An empty library has no list at all.
    return { items: [] };
  }
  return page(found.contents ?? found.items ?? [], found.continuations);
}

function nextPage(answer: unknown): Page {
  const appended = find(answer, 'appendContinuationItemsAction') as { continuationItems?: unknown[] } | undefined;
  if (appended) {
    return page(appended.continuationItems ?? []);
  }
  const old = (find(answer, 'gridContinuation') ?? find(answer, 'musicPlaylistShelfContinuation')) as Renderer | undefined;
  return old ? page(old.items ?? old.contents ?? [], old.continuations) : { items: [] };
}

/**
 * A list's items and the token for the next page. The item that may end the
 * list with the token is left in: it is neither a row nor a tile, so the
 * readers pass over it.
 */
function page(items: unknown[], continuations?: Renderer['continuations']): Page {
  const last = items.at(-1) as { continuationItemRenderer?: { continuationEndpoint?: { continuationCommand?: { token?: string } } } } | undefined;
  const token = last?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  if (token) {
    return { items, next: token };
  }
  const old = continuations?.[0]?.nextContinuationData?.continuation;
  return old ? { items, next: old, old: true } : { items };
}

/** The first object under `key` anywhere in the answer, searched breadth first. */
function find(answer: unknown, key: string): unknown {
  const queue = [answer];
  while (queue.length > 0) {
    const value = queue.shift();
    if (value && typeof value === 'object') {
      if (!Array.isArray(value) && key in value) return (value as Record<string, unknown>)[key];
      queue.push(...Object.values(value));
    }
  }
  return undefined;
}

interface Tile {
  musicTwoRowItemRenderer?: {
    title?: { runs?: (Run & { navigationEndpoint?: { browseEndpoint?: { browseId?: string } } })[] };
    subtitle?: { runs?: Run[] };
  };
}

/** A tile of a grid: its title, what it links to, and the line under the title. */
function tile(item: unknown): { title: string; browseId?: string; subtitle: Run[] } {
  const renderer = (item as Tile).musicTwoRowItemRenderer;
  const runs = renderer?.title?.runs ?? [];
  return { title: text(runs), browseId: runs[0]?.navigationEndpoint?.browseEndpoint?.browseId, subtitle: renderer?.subtitle?.runs ?? [] };
}
