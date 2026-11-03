/**
 * What to do with a track once its search results are scored: take the best
 * one, ask a person, or report that YouTube Music does not have it.
 *
 * A wrong track liked silently is worse than a question, so a match is taken
 * only when it is clearly better than the rest: a second result nearly as
 * good may be another recording, and then a person decides.
 */

import type { Track } from './library.ts';
import { type Candidate, type Score, score } from './score.ts';

export interface Scored {
  candidate: Candidate;
  score: Score;
}

export type Decision =
  | { status: 'matched'; match: Scored; why: string }
  /** The best results, best first, for a person to choose from. */
  | { status: 'review'; candidates: Scored[]; why: string }
  /** The closest results, if any, for the report. */
  | { status: 'missing'; candidates: Scored[]; why: string };

/** At or above this a result is the track, whatever else came up: two this close are the same recording on two releases. */
export const SURE = 0.95;
/** At or above this a result is taken, unless another one comes close to it. */
export const ACCEPT = 0.85;
/** How close counts as close. */
export const GAP = 0.1;
/** Below this a result is not worth anyone's time. */
export const REVIEW = 0.5;
/** How many results a person is shown at most. */
export const SHOWN = 3;

export function decide(track: Track, candidates: Candidate[]): Decision {
  const scored = candidates
    .map(candidate => ({ candidate, score: score(track, candidate) }))
    // Best first; between equals, the audio release before a video. The
    // sort is stable, so equals otherwise keep the order YouTube Music gave.
    .sort(
      (a, b) =>
        b.score.value - a.score.value ||
        Number(a.candidate.kind === 'video') - Number(b.candidate.kind === 'video'),
    );

  const [best, second] = scored;
  if (!best || best.score.value < REVIEW) {
    return {
      status: 'missing',
      candidates: scored.slice(0, SHOWN),
      why: best ? 'no result is close enough' : 'no results',
    };
  }
  if (best.score.value >= SURE) {
    return { status: 'matched', match: best, why: 'a sure match' };
  }
  if (best.score.value >= ACCEPT) {
    if (!second || second.score.value < best.score.value - GAP) {
      return { status: 'matched', match: best, why: 'the best result, well ahead of the rest' };
    }
    return { status: 'review', candidates: scored.slice(0, SHOWN), why: 'two results come close' };
  }
  return { status: 'review', candidates: scored.slice(0, SHOWN), why: 'not sure enough' };
}
