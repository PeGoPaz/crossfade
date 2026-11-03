/**
 * The library file: what was exported from a music service, in a form that
 * does not depend on that service. docs/library-format.md describes it for
 * people; this module checks a file against it.
 *
 * Each track is stored once, in `tracks`, and the likes and playlists refer
 * to it by id. A track that is liked and sits in three playlists is then
 * looked up on YouTube Music once, not four times.
 */

export const FORMAT = 'crossfade-library';
export const FORMAT_VERSION = 1;

export interface Track {
  /** The track's id on the service it was exported from. */
  id: string;
  title: string;
  /** A note the service keeps apart from the title, like "Remastered 2011". */
  version?: string;
  /** May be empty when the service names no artist. */
  artists: string[];
  album?: string;
  year?: number;
  durationMs?: number;
  /** International Standard Recording Code, when the service gives one. */
  isrc?: string;
}

export interface Like {
  /** The id of a track in `tracks`. */
  track: string;
  likedAt?: string;
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  /** Track ids in playlist order. A track may appear more than once. */
  tracks: string[];
}

export interface Album {
  id: string;
  title: string;
  artists: string[];
  year?: number;
  trackCount?: number;
  likedAt?: string;
}

export interface Library {
  format: typeof FORMAT;
  version: typeof FORMAT_VERSION;
  /** The service it was exported from, e.g. "yandex-music". */
  source: string;
  exportedAt: string;
  tracks: Track[];
  liked: Like[];
  playlists: Playlist[];
  albums: Album[];
}

export class LibraryError extends Error {
  /** One line per problem: where it is in the file, and what is wrong. */
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`The library file is not valid:\n  ${problems.join('\n  ')}`);
    this.name = 'LibraryError';
    this.problems = problems;
  }
}

/** A hand-edited file can be wrong in hundreds of places; the first ones are enough to start fixing. */
const MAX_PROBLEMS = 20;

/** Reads library.json. Throws a LibraryError that lists what is wrong. */
export function parseLibrary(json: string): Library {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new LibraryError([`not JSON: ${(error as Error).message}`]);
  }
  return checkLibrary(value);
}

/** Checks a parsed file and returns it typed. Fields the format does not define are ignored. */
export function checkLibrary(value: unknown): Library {
  if (!isObject(value) || value.format !== FORMAT) {
    throw new LibraryError([`not a crossfade library file: "format" should be "${FORMAT}"`]);
  }
  if (typeof value.version === 'number' && value.version > FORMAT_VERSION) {
    throw new LibraryError([
      `written by a newer crossfade (format version ${value.version}); update crossfade to read it`,
    ]);
  }

  const problems: string[] = [];
  const report = (path: string, message: string) => problems.push(`${path}: ${message}`);

  checkFields(value, LIBRARY, '', report);
  const tracks = itemsOf(value, 'tracks', TRACK, report);
  const liked = itemsOf(value, 'liked', LIKE, report);
  const playlists = itemsOf(value, 'playlists', PLAYLIST, report);
  const albums = itemsOf(value, 'albums', ALBUM, report);

  const trackIds = unique(tracks, 'id', report);
  unique(liked, 'track', report);
  unique(playlists, 'id', report);
  unique(albums, 'id', report);
  for (const [like, path] of liked) {
    known(like.track, `${path}.track`, trackIds, report);
  }
  for (const [playlist, path] of playlists) {
    if (Array.isArray(playlist.tracks)) {
      playlist.tracks.forEach((id: unknown, i) => known(id, `${path}.tracks[${i}]`, trackIds, report));
    }
  }

  if (problems.length > MAX_PROBLEMS) {
    const more = problems.length - MAX_PROBLEMS;
    throw new LibraryError([...problems.slice(0, MAX_PROBLEMS), `... and ${more} more`]);
  }
  if (problems.length > 0) {
    throw new LibraryError(problems);
  }
  return value as unknown as Library;
}

type Report = (path: string, message: string) => void;
/** Returns what is wrong with a value, or undefined if nothing is. */
type Check = (value: unknown) => string | undefined;
type Fields = Record<string, Check>;

const text: Check = value =>
  typeof value === 'string' && value.trim() !== '' ? undefined : 'should be a non-empty string';

const names: Check = value =>
  Array.isArray(value) && value.every(name => text(name) === undefined)
    ? undefined
    : 'should be a list of non-empty strings';

const count: Check = value =>
  Number.isInteger(value) && (value as number) > 0 ? undefined : 'should be a whole number above 0';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const date: Check = value =>
  typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
    ? undefined
    : 'should be a date and time like 2026-11-03T08:30:00Z';

// Country, registrant, year, number: GB-AYE-69-00531 is written GBAYE6900531.
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const isrc: Check = value =>
  typeof value === 'string' && ISRC.test(value) ? undefined : 'should be 12 letters and digits like GBAYE6900531';

const list: Check = value => (Array.isArray(value) ? undefined : 'should be a list');

const optional =
  (check: Check): Check =>
  value =>
    value === undefined ? undefined : check(value);

const LIBRARY: Fields = {
  version: value => (value === FORMAT_VERSION ? undefined : `should be ${FORMAT_VERSION}`),
  source: text,
  exportedAt: date,
  tracks: list,
  liked: list,
  playlists: list,
  albums: list,
};

const TRACK: Fields = {
  id: text,
  title: text,
  version: optional(text),
  artists: names,
  album: optional(text),
  year: optional(count),
  durationMs: optional(count),
  isrc: optional(isrc),
};

const LIKE: Fields = { track: text, likedAt: optional(date) };

const PLAYLIST: Fields = {
  id: text,
  title: text,
  description: optional(value => (typeof value === 'string' ? undefined : 'should be a string')),
  tracks: value =>
    Array.isArray(value) && value.every(id => text(id) === undefined) ? undefined : 'should be a list of track ids',
};

const ALBUM: Fields = {
  id: text,
  title: text,
  artists: names,
  year: optional(count),
  trackCount: optional(count),
  likedAt: optional(date),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkFields(item: Record<string, unknown>, fields: Fields, path: string, report: Report): void {
  for (const [name, check] of Object.entries(fields)) {
    const problem = check(item[name]);
    if (problem) {
      report(path ? `${path}.${name}` : name, problem);
    }
  }
}

type Item = Record<string, unknown>;

/**
 * The objects in one of the file's lists, each with its path for messages.
 * Their fields are checked here; an item with a wrong field is still
 * returned, so that a like does not also get reported as pointing nowhere
 * because the track it points to has, say, no title.
 */
function itemsOf(library: Item, name: string, fields: Fields, report: Report): [Item, string][] {
  const items = library[name];
  if (!Array.isArray(items)) {
    return [];
  }
  const objects: [Item, string][] = [];
  items.forEach((item: unknown, i) => {
    const path = `${name}[${i}]`;
    if (isObject(item)) {
      checkFields(item, fields, path, report);
      objects.push([item, path]);
    } else {
      report(path, 'should be an object');
    }
  });
  return objects;
}

/** Reports items that repeat another's value of `field`, and returns the values. */
function unique(items: [Item, string][], field: string, report: Report): Set<string> {
  const seen = new Map<string, string>();
  for (const [item, path] of items) {
    const id = item[field];
    if (typeof id !== 'string') {
      continue;
    }
    const first = seen.get(id);
    if (first) {
      report(`${path}.${field}`, `"${id}" is already in ${first}`);
    } else {
      seen.set(id, path);
    }
  }
  return new Set(seen.keys());
}

function known(id: unknown, path: string, trackIds: Set<string>, report: Report): void {
  if (typeof id === 'string' && !trackIds.has(id)) {
    report(path, `no track with id "${id}" in tracks`);
  }
}
