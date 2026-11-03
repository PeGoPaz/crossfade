/**
 * `crossfade import`: adds the matches to YouTube Music. For now it can only
 * show what it would do (--dry-run); carrying the plan out comes next.
 */

import { readFile } from 'node:fs/promises';

import type { Io } from './cli.ts';
import { type Deps, defaultDeps } from './deps.ts';
import { type Library, parseLibrary } from './library.ts';
import { type Matches, parseMatches } from './matches.ts';
import { describePlan, planImport } from './plan.ts';
import { HttpError, Requests } from './requests.ts';
import { YouTubeLibrary, type YouTubeLibraryContents, readYouTubeLibrary } from './ytmusic/library.ts';
import type { YouTubeSession } from './ytmusic/session.ts';

export type ReadExisting = (session: YouTubeSession, progress: (message: string) => void) => Promise<YouTubeLibraryContents>;

/** Reading is a few requests a second, like the export. */
const SPACING_MS = 250;

export async function importMatches(
  libraryFile: string,
  matchesFile: string,
  dryRun: boolean,
  io: Io,
  deps: Deps = defaultDeps(),
  readExisting?: ReadExisting,
): Promise<number> {
  if (!dryRun) {
    io.err('crossfade import can only show its plan so far. Run: crossfade import --dry-run');
    return 1;
  }
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
    readExisting ??
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

  for (const line of describePlan(planImport(library, matches, existing))) io.out(line);
  io.out('Nothing was changed: this was a dry run.');
  return 0;
}
