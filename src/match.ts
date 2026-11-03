/**
 * `crossfade match`: looks for every track of the library on YouTube Music
 * and saves what it decided in the matches file.
 *
 * Each track is searched among songs first. Only when that gives no sure
 * match are videos searched too: some music is on YouTube Music only as an
 * upload or a music video, and the extra search is spent only where needed.
 *
 * The file is saved as the run goes, so a run that stops - Ctrl+C, a
 * network gone, a service asking to wait - goes on where it stopped when
 * started again.
 */

import { readFile } from 'node:fs/promises';

import type { Io } from './cli.ts';
import { type Decision, decide } from './decide.ts';
import { type Deps, defaultDeps } from './deps.ts';
import { saveJson } from './files.ts';
import { type Library, type Track, parseLibrary } from './library.ts';
import { type Matches, counts, emptyMatches, parseMatches } from './matches.ts';
import { HttpError, Requests } from './requests.ts';
import type { Candidate } from './score.ts';
import { count } from './words.ts';
import { YouTubeMusic } from './ytmusic/search.ts';

export type Search = (query: string, kind: 'song' | 'video') => Promise<Candidate[]>;

/** One search a second: a person searching fast, about twenty minutes for a thousand tracks. */
const SPACING_MS = 1000;
/** How often the matches file is saved during a run, in tracks. */
const SAVE_EVERY = 10;

/** What to type into the search box for a track: its main artist, title and version note. */
export function query(track: Track): string {
  return [track.artists[0], track.title, track.version].filter(Boolean).join(' ');
}

export async function findTrack(track: Track, search: Search): Promise<Decision> {
  const songs = await search(query(track), 'song');
  const decision = decide(track, songs);
  if (decision.status === 'matched') {
    return decision;
  }
  const seen = new Set(songs.map(song => song.id));
  const videos = (await search(query(track), 'video')).filter(video => !seen.has(video.id));
  return decide(track, [...songs, ...videos]);
}

export async function matchLibrary(
  libraryFile: string,
  matchesFile: string,
  io: Io,
  deps: Deps = defaultDeps(),
  search?: Search,
): Promise<number> {
  let library: Library;
  let matches: Matches;
  try {
    library = parseLibrary(await readFile(libraryFile, 'utf8'));
    matches = await readMatches(matchesFile, library);
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }

  const youtube = new YouTubeMusic(
    new Requests({
      spacingMs: SPACING_MS,
      fetch: deps.fetch,
      clock: deps.clock,
      onWait: (ms, reason) => io.err(`YouTube Music: ${reason}; trying again in ${Math.ceil(ms / 1000)} s`),
    }),
    () => deps.clock.now(),
  );
  const find = search ?? ((text, kind) => youtube.search(text, kind));

  const todo = library.tracks.filter(track => !matches.tracks[track.id]);
  if (todo.length < library.tracks.length) {
    io.err(`${count(library.tracks.length - todo.length, 'track')} matched before; matching the other ${todo.length}.`);
  }
  try {
    for (const [i, track] of todo.entries()) {
      matches.tracks[track.id] = await findTrack(track, find);
      if ((i + 1) % SAVE_EVERY === 0 || i + 1 === todo.length) {
        await saveJson(matchesFile, matches);
        const { matched, review, missing } = counts(matches);
        io.err(`  ${i + 1} of ${todo.length}: ${matched} matched, ${review} to review, ${missing} not found`);
      }
    }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    await saveJson(matchesFile, matches);
    io.err(`${error.message}\nStopped after ${count(Object.keys(matches.tracks).length, 'track')}; run "crossfade match" again to go on.`);
    return 1;
  }

  await saveJson(matchesFile, matches);
  const { matched, review, missing } = counts(matches);
  io.out(`Saved ${matchesFile}: ${matched} matched, ${review} to review, ${missing} not found on YouTube Music.`);
  if (review > 0) {
    io.out('Next: crossfade review');
  }
  return 0;
}

/** The matches made so far for this library, or none. */
async function readMatches(file: string, library: Library): Promise<Matches> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyMatches(library);
    throw error;
  }
  const matches = parseMatches(text);
  if (matches.library.source !== library.source) {
    throw new Error(`${file} holds matches for a library from ${matches.library.source}, not ${library.source}`);
  }
  return matches;
}
