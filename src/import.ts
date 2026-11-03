/**
 * `crossfade import`: adds the matches to YouTube Music. It reads what the
 * library holds, shows the plan, and carries it out once you say yes;
 * with --dry-run it stops after the plan.
 */

import { readFile } from 'node:fs/promises';

import type { Io } from './cli.ts';
import { type Deps, defaultDeps } from './deps.ts';
import { type Library, parseLibrary } from './library.ts';
import { type Matches, parseMatches } from './matches.ts';
import { type Writer, carryOut, describePlan, planImport } from './plan.ts';
import { type Ask, terminal } from './prompt.ts';
import { HttpError, Requests } from './requests.ts';
import { YouTubeLibrary, type YouTubeLibraryContents, readYouTubeLibrary } from './ytmusic/library.ts';
import type { YouTubeSession } from './ytmusic/session.ts';
import { YouTubeWriter } from './ytmusic/write.ts';

export type ReadExisting = (session: YouTubeSession, progress: (message: string) => void) => Promise<YouTubeLibraryContents>;

/** For tests: everything import does on YouTube Music and at the terminal. */
export interface ImportParts {
  readExisting?: ReadExisting;
  writer?: Writer;
  ask?: Ask;
}

/** Reading is a few requests a second, like the export. */
const SPACING_MS = 250;
/** Changes are slower: a second and a half apart, about half an hour for a thousand likes. */
const WRITE_SPACING_MS = 1500;

export async function importMatches(
  libraryFile: string,
  matchesFile: string,
  dryRun: boolean,
  io: Io,
  deps: Deps = defaultDeps(),
  parts: ImportParts = {},
): Promise<number> {
  let library: Library;
  let matches: Matches;
  try {
    library = parseLibrary(await readFile(libraryFile, 'utf8'));
    matches = parseMatches(await readFile(matchesFile, 'utf8'));
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }
  const session = await deps.store.load<YouTubeSession>('youtube-music');
  if (!session) {
    io.err('crossfade is not signed in to YouTube Music. Run: crossfade login youtube-music');
    return 1;
  }

  const read: ReadExisting =
    parts.readExisting ??
    ((session, progress) => {
      const requests = new Requests({ spacingMs: SPACING_MS, fetch: deps.fetch, clock: deps.clock });
      return readYouTubeLibrary(new YouTubeLibrary(requests, session, () => deps.clock.now()), progress);
    });
  let existing: YouTubeLibraryContents;
  try {
    io.err('Reading what is in your YouTube Music library...');
    existing = await read(session, message => io.err(`  ${message}`));
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    io.err(error.message);
    return 1;
  }

  const plan = planImport(library, matches, existing);
  for (const line of describePlan(plan)) io.out(line);
  if (library.albums.length > 0) {
    io.out(`Liked albums (${library.albums.length}) are not moved yet.`);
  }
  if (plan.likes.length === 0 && plan.playlists.every(playlist => playlist.add.length === 0)) {
    io.out('Nothing to add: YouTube Music has it all.');
    return 0;
  }
  if (dryRun) {
    io.out('Nothing was changed: this was a dry run.');
    return 0;
  }
  if (!(await confirm(parts.ask))) {
    io.out('Nothing was changed.');
    return 0;
  }

  const writer =
    parts.writer ??
    new YouTubeWriter(new Requests({ spacingMs: WRITE_SPACING_MS, fetch: deps.fetch, clock: deps.clock }), session, () => deps.clock.now());
  try {
    await carryOut(plan, writer, message => io.err(`  ${message}`));
  } catch (error) {
    io.err(`${(error as Error).message}\nStopped. Run "crossfade import" again to go on: what is done already will be skipped.`);
    return 1;
  }
  io.out('Done. Run "crossfade import --dry-run" to check that nothing is left.');
  return 0;
}

/** Asks before changing anything; only yes goes ahead. */
async function confirm(ask?: Ask): Promise<boolean> {
  const input = ask ? { ask, close: () => {} } : terminal();
  try {
    const answer = await input.ask('Go ahead and change your YouTube Music library? (y/N) ');
    return /^y(es)?$/i.test(answer?.trim() ?? '');
  } finally {
    input.close();
  }
}
