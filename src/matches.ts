/**
 * The matches file: for every track of a library, what was decided about
 * it on YouTube Music - matched, to review, or missing - with the results
 * behind the decision, so a person reviewing it sees what crossfade saw.
 *
 * Decisions are kept by track id, so a match run that stops can go on where
 * it stopped, and a library exported again keeps the decisions for the
 * tracks it still has.
 */

import type { Decision } from './decide.ts';

export const MATCHES_FORMAT = 'crossfade-matches';
export const MATCHES_VERSION = 1;

/** A decision, and who made it: crossfade, or a person in review. */
export type Entry = Decision & { by?: 'you' };

export interface Matches {
  format: typeof MATCHES_FORMAT;
  version: typeof MATCHES_VERSION;
  /** The library the tracks come from. */
  library: { source: string; exportedAt: string };
  tracks: Record<string, Entry>;
}

export function emptyMatches(library: { source: string; exportedAt: string }): Matches {
  return { format: MATCHES_FORMAT, version: MATCHES_VERSION, library: { source: library.source, exportedAt: library.exportedAt }, tracks: {} };
}

/** Reads a matches file. Only its outline is checked: crossfade wrote it, and a person changes it through review. */
export function parseMatches(json: string): Matches {
  let value: Partial<Matches>;
  try {
    value = JSON.parse(json) as Partial<Matches>;
  } catch (error) {
    throw new Error(`The matches file is not JSON: ${(error as Error).message}`);
  }
  if (value?.format !== MATCHES_FORMAT) {
    throw new Error(`Not a crossfade matches file: "format" should be "${MATCHES_FORMAT}"`);
  }
  if (value.version !== MATCHES_VERSION) {
    throw new Error(`The matches file has format version ${value.version}; this crossfade reads version ${MATCHES_VERSION}`);
  }
  if (typeof value.tracks !== 'object' || value.tracks === null || Array.isArray(value.tracks)) {
    throw new Error('The matches file has no "tracks"');
  }
  return value as Matches;
}

export function counts(matches: Matches): Record<Decision['status'], number> {
  const result = { matched: 0, review: 0, missing: 0 };
  for (const entry of Object.values(matches.tracks)) result[entry.status] += 1;
  return result;
}
