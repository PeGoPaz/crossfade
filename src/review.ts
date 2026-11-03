/**
 * `crossfade review`: goes through the tracks crossfade was not sure of and
 * asks which result, if any, is the track. Each answer is saved at once, so
 * the review can be left at any point and taken up again later.
 */

import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import type { Io } from './cli.ts';
import type { Scored } from './decide.ts';
import { saveJson } from './files.ts';
import { type Library, type Track, parseLibrary } from './library.ts';
import { type Entry, type Matches, counts, parseMatches } from './matches.ts';
import { count } from './words.ts';

/** Shows a prompt and returns the line typed, or undefined when input has ended. */
export type Ask = (prompt: string) => Promise<string | undefined>;

export type Answer = { pick: number } | { none: true } | { skip: true } | { quit: true };

/** Reads what was typed: a result's number, n for none of them, s or nothing to skip, q to stop. */
export function parseAnswer(input: string, choices: number): Answer | undefined {
  const text = input.trim().toLowerCase();
  if (text === '' || text === 's') return { skip: true };
  if (text === 'n') return { none: true };
  if (text === 'q') return { quit: true };
  const number = Number(text);
  return Number.isInteger(number) && number >= 1 && number <= choices ? { pick: number - 1 } : undefined;
}

/** The entry after an answer. A skip leaves it as it was. */
export function answer(entry: Entry & { status: 'review' }, given: Answer): Entry {
  if ('pick' in given) {
    const match = entry.candidates[given.pick];
    if (match) return { status: 'matched', match, why: 'chosen in review', by: 'you' };
  }
  if ('none' in given) {
    return { status: 'missing', candidates: entry.candidates, why: 'none of the results is the track', by: 'you' };
  }
  return entry;
}

/** A track and its results, as shown to the person deciding. */
export function describe(track: Track, entry: Entry & { status: 'review' }, place: string): string {
  const lines = [`${place} ${track.artists.join(', ')} - ${title(track.title, track.version)}  ${duration(track.durationMs)}  (${entry.why})`];
  entry.candidates.forEach(({ candidate, score }: Scored, i) => {
    lines.push(
      `  ${i + 1}  ${candidate.artists.join(', ')} - ${candidate.title}  ${duration(candidate.durationMs)}  ${candidate.kind ?? ''}`.trimEnd(),
      `     ${Math.round(score.value * 100)}%: ${score.reasons.join(', ')}`,
      `     https://music.youtube.com/watch?v=${candidate.id}`,
    );
  });
  return lines.join('\n');
}

export async function review(libraryFile: string, matchesFile: string, io: Io, ask?: Ask): Promise<number> {
  let library: Library;
  let matches: Matches;
  try {
    library = parseLibrary(await readFile(libraryFile, 'utf8'));
    matches = parseMatches(await readFile(matchesFile, 'utf8'));
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }

  const todo = library.tracks.filter(track => matches.tracks[track.id]?.status === 'review');
  if (todo.length === 0) {
    io.out('Nothing to review.');
    return 0;
  }
  io.out(`${count(todo.length, 'track')} to review. For each: the number of the right result, n if none is, s to skip it for now, q to stop.`);

  // The terminal is opened only now: an open one would keep crossfade from exiting.
  const input = ask ? { ask, close: () => {} } : terminal();
  let done;
  try {
    done = await reviewTracks(todo, matches, matchesFile, io, input.ask);
  } finally {
    input.close();
  }

  const left = counts(matches).review;
  io.out(
    `\nChose ${count(done.chosen, 'match', 'matches')}, marked ${done.none} as not on YouTube Music, skipped ${done.skipped}. ` +
      (left > 0 ? `${count(left, 'track')} left to review.` : 'Nothing left to review.'),
  );
  return 0;
}

/** Asks about each track in turn, saving the matches after every decision, until the tracks or the person run out. */
async function reviewTracks(todo: Track[], matches: Matches, matchesFile: string, io: Io, ask: Ask) {
  const done = { chosen: 0, none: 0, skipped: 0 };
  for (const [i, track] of todo.entries()) {
    const entry = matches.tracks[track.id] as Entry & { status: 'review' };
    io.out(`\n${describe(track, entry, `[${i + 1} of ${todo.length}]`)}`);
    let given: Answer | undefined;
    while (!given) {
      const typed = await ask(`Which one is it? (1-${entry.candidates.length}, n, s, q) `);
      given = typed === undefined ? { quit: true } : parseAnswer(typed, entry.candidates.length);
    }
    if ('quit' in given) break;
    matches.tracks[track.id] = answer(entry, given);
    done['pick' in given ? 'chosen' : 'none' in given ? 'none' : 'skipped'] += 1;
    if (!('skip' in given)) await saveJson(matchesFile, matches);
  }
  return done;
}

/** Answers typed in the terminal, a line at a time. */
function terminal(): { ask: Ask; close: () => void } {
  const readline = createInterface({ input: process.stdin });
  const lines = readline[Symbol.asyncIterator]();
  return {
    ask: async prompt => {
      process.stdout.write(prompt);
      const next = await lines.next();
      return next.done ? undefined : next.value;
    },
    close: () => readline.close(),
  };
}

function title(name: string, version: string | undefined): string {
  return version ? `${name} (${version})` : name;
}

function duration(ms: number | undefined): string {
  if (ms === undefined) return '?:??';
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
