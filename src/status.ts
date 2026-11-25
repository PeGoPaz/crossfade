/**
 * `crossfade status`: how far the move has got, read from the files the
 * steps wrote and the sign-ins kept on this computer, and the step to run
 * next. It changes nothing and asks no service anything - so it works with
 * no network, and a sign-in it reports may still turn out to have expired.
 */

import { readFile } from 'node:fs/promises';

import type { Io } from './cli.ts';
import type { Service } from './credentials.ts';
import { type Deps, defaultDeps } from './deps.ts';
import { type Library, parseLibrary } from './library.ts';
import { type Matches, parseMatches } from './matches.ts';
import { count } from './words.ts';

const SERVICES: [Service, string][] = [
  ['yandex-music', 'Yandex Music'],
  ['youtube-music', 'YouTube Music'],
];

/** What is there so far. A sign-in that cannot be read holds the reason instead of true. */
export interface Progress {
  signedIn: Record<Service, boolean | string>;
  library?: Library;
  matches?: Matches;
}

/** How many of the library's tracks and albums have a decision, and which. */
export function tally(library: Library, matches: Matches | undefined) {
  const result = { tracks: 0, matched: 0, review: 0, missing: 0, albums: 0, albumsMatched: 0 };
  for (const track of library.tracks) {
    const entry = matches?.tracks[track.id];
    if (!entry) continue;
    result.tracks += 1;
    result[entry.status] += 1;
  }
  for (const album of library.albums) {
    const decision = matches?.albums?.[album.id];
    if (!decision) continue;
    result.albums += 1;
    if (decision.status === 'matched') result.albumsMatched += 1;
  }
  return result;
}

/** The command to run next. */
export function nextStep(progress: Progress): string {
  const { library, matches, signedIn } = progress;
  if (!library)
    return signedIn['yandex-music'] === true ? 'crossfade export' : 'crossfade login yandex-music';
  const done = tally(library, matches);
  if (done.tracks < library.tracks.length || done.albums < library.albums.length)
    return 'crossfade match';
  if (done.review > 0) return 'crossfade review';
  if (signedIn['youtube-music'] !== true) return 'crossfade login youtube-music';
  return 'crossfade import --dry-run, then crossfade import';
}

export function describeProgress(
  progress: Progress,
  libraryFile: string,
  matchesFile: string,
): string[] {
  const lines = SERVICES.map(([service, name]) => {
    const state = progress.signedIn[service];
    return `${name}: ${state === true ? 'signed in' : state === false ? 'not signed in' : state}`;
  });
  const { library, matches } = progress;
  if (!library) {
    lines.push(`${libraryFile}: not exported yet`);
  } else {
    const parts = [
      `${count(library.tracks.length, 'track')} (${library.liked.length} liked)`,
      count(library.playlists.length, 'playlist'),
      count(library.albums.length, 'album'),
    ];
    lines.push(
      `${libraryFile}: ${parts.join(', ')}, exported from ${library.source} on ${library.exportedAt.slice(0, 10)}`,
    );
    const done = tally(library, matches);
    if (!matches) {
      lines.push(`${matchesFile}: not matched yet`);
    } else {
      let line = `${matchesFile}: ${done.tracks} of ${count(library.tracks.length, 'track')} decided - ${done.matched} matched, ${done.review} to review, ${done.missing} not found`;
      if (library.albums.length > 0)
        line += `; ${done.albumsMatched} of ${count(library.albums.length, 'album')} matched`;
      lines.push(line);
    }
  }
  lines.push(`Next: ${nextStep(progress)}`);
  return lines;
}

export async function status(
  libraryFile: string,
  matchesFile: string,
  io: Io,
  deps: Deps = defaultDeps(),
): Promise<number> {
  const signedIn = {} as Progress['signedIn'];
  for (const [service] of SERVICES) {
    try {
      signedIn[service] = (await deps.store.load(service)) !== undefined;
    } catch (error) {
      signedIn[service] = (error as Error).message;
    }
  }
  let library: Library | undefined;
  let matches: Matches | undefined;
  try {
    const libraryText = await readIfThere(libraryFile);
    library = libraryText === undefined ? undefined : parseLibrary(libraryText);
    const matchesText = library && (await readIfThere(matchesFile));
    matches = matchesText === undefined ? undefined : parseMatches(matchesText);
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }
  for (const line of describeProgress({ signedIn, library, matches }, libraryFile, matchesFile))
    io.out(line);
  return 0;
}

async function readIfThere(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
