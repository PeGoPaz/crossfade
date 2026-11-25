/**
 * Matching a liked album to an album on YouTube Music, so it can be saved to
 * the library. Unlike a track, an album has no version notes or length to
 * compare, and saving the wrong one is easily undone, so an album is either
 * matched or left out - there is no review step. A doubtful album is left out
 * with its closest results kept for the report, the same as a track that is
 * not on YouTube Music.
 */

import type { Album } from './library.ts';
import type { AlbumCandidate, Score } from './score.ts';
import { artistSimilarity, similarity } from './similarity.ts';
import { key } from './text.ts';

/** A result and how sure crossfade is that it is the album. */
export interface ScoredAlbum {
  candidate: AlbumCandidate;
  score: Score;
}

export type AlbumDecision =
  | { status: 'matched'; match: ScoredAlbum; why: string }
  /** The closest results, if any, for the report. */
  | { status: 'missing'; candidates: ScoredAlbum[]; why: string };

/** At or above this an album is taken, whatever else came up. */
export const SURE = 0.95;
/** At or above this an album is taken, unless another one comes close to it. */
export const ACCEPT = 0.85;
/** How close counts as close. */
export const GAP = 0.1;
/** How many results the report shows at most. */
export const SHOWN = 3;

/** What to type into the search box for an album: its main artist and title. */
export function albumQuery(album: Album): string {
  return [album.artists[0], album.title].filter(Boolean).join(' ');
}

/**
 * How sure crossfade is that an album found on YouTube Music is the liked
 * album: the title and the artists carry the score, and a different year
 * lowers it a little, because a re-release is usually the same album but a
 * deluxe edition may not be.
 */
export function scoreAlbum(album: Album, candidate: AlbumCandidate): Score {
  const reasons: string[] = [];
  const title = similarity(key(album.title), key(candidate.title));
  reasons.push(`title ${percent(title)}`);

  let value: number;
  if (album.artists.length === 0 || candidate.artists.length === 0) {
    value = related(title);
    reasons.push('no artists to compare');
  } else {
    const artists = artistSimilarity(album.artists.map(key), candidate.artists.map(key));
    reasons.push(`artists ${percent(artists)}`);
    value = Math.sqrt(related(title) * related(artists));
  }

  if (album.year !== undefined && candidate.year !== undefined) {
    if (album.year === candidate.year) {
      reasons.push('same year');
    } else {
      // A different year is often the same album re-released, so it lowers
      // the score rather than ruling the album out.
      value *= 0.9;
      reasons.push(`year differs (${album.year} vs ${candidate.year})`);
    }
  } else {
    reasons.push('year unknown');
  }

  return { value: Math.round(value * 1000) / 1000, reasons };
}

/** An album and its results as matched or missing, best first. */
export function decideAlbum(album: Album, candidates: AlbumCandidate[]): AlbumDecision {
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreAlbum(album, candidate) }))
    .sort((a, b) => b.score.value - a.score.value);

  const [best, second] = scored;
  if (!best || best.score.value < ACCEPT) {
    return {
      status: 'missing',
      candidates: scored.slice(0, SHOWN),
      why: best ? 'no result is close enough' : 'no results',
    };
  }
  if (best.score.value >= SURE) {
    return { status: 'matched', match: best, why: 'a sure match' };
  }
  if (!second || second.score.value < best.score.value - GAP) {
    return { status: 'matched', match: best, why: 'the best result, well ahead of the rest' };
  }
  return { status: 'missing', candidates: scored.slice(0, SHOWN), why: 'two results come close' };
}

export type AlbumSearch = (query: string) => Promise<AlbumCandidate[]>;

/** Searches YouTube Music for an album and decides what it is. */
export async function findAlbum(album: Album, search: AlbumSearch): Promise<AlbumDecision> {
  return decideAlbum(album, await search(albumQuery(album)));
}

/** Edit distance rarely falls to nothing between unrelated names; see score.ts. */
const UNRELATED = 0.4;

function related(similarity: number): number {
  return Math.max(0, (similarity - UNRELATED) / (1 - UNRELATED));
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
