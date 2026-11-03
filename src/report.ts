/**
 * `crossfade report`: what could not be moved, and why - the tracks
 * YouTube Music does not have, the ones still waiting for a decision, and
 * the liked albums, which crossfade does not move yet. Each track says
 * where it is in the library, so you know what a gap in a playlist is.
 */

import { readFile } from 'node:fs/promises';

import type { Io } from './cli.ts';
import { type Library, type Track, parseLibrary } from './library.ts';
import { type Matches, parseMatches } from './matches.ts';
import { count } from './words.ts';

export function describeGaps(library: Library, matches: Matches): string[] {
  const places = new Map<string, string[]>();
  const add = (track: string, place: string) => places.set(track, [...(places.get(track) ?? []), place]);
  for (const like of library.liked) add(like.track, 'liked');
  for (const playlist of library.playlists) {
    for (const track of new Set(playlist.tracks)) add(track, playlist.title);
  }
  const line = (track: Track) => `  ${name(track)}  [${(places.get(track.id) ?? []).join(', ')}]`;

  const missing = library.tracks.filter(track => matches.tracks[track.id]?.status === 'missing');
  const review = library.tracks.filter(track => matches.tracks[track.id]?.status === 'review');
  const unmatched = library.tracks.filter(track => !matches.tracks[track.id]);
  const lines: string[] = [];

  if (missing.length > 0) {
    lines.push(`Not on YouTube Music (${missing.length}):`);
    for (const track of missing) {
      lines.push(line(track));
      const entry = matches.tracks[track.id];
      const closest = entry?.status === 'missing' ? entry.candidates[0] : undefined;
      if (closest) {
        const { candidate, score } = closest;
        lines.push(`    closest: ${candidate.artists.join(', ')} - ${candidate.title}, ${Math.round(score.value * 100)}%: ${score.reasons.join(', ')}`);
      }
    }
  }
  if (review.length > 0) {
    lines.push(`To review (${review.length}), with crossfade review:`, ...review.map(line));
  }
  if (unmatched.length > 0) {
    lines.push(`Not matched yet: ${count(unmatched.length, 'track')}. Run crossfade match.`);
  }
  if (library.albums.length > 0) {
    lines.push(
      `Liked albums, which crossfade does not move yet (${library.albums.length}):`,
      ...library.albums.map(album => `  ${album.artists.join(', ')} - ${album.title}${album.year ? ` (${album.year})` : ''}`),
    );
  }
  return lines.length > 0 ? lines : ['Every track of the library has a match on YouTube Music.'];
}

export async function report(libraryFile: string, matchesFile: string, io: Io): Promise<number> {
  try {
    const library = parseLibrary(await readFile(libraryFile, 'utf8'));
    const matches = parseMatches(await readFile(matchesFile, 'utf8'));
    for (const line of describeGaps(library, matches)) io.out(line);
    return 0;
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }
}

function name(track: Track): string {
  return `${track.artists.join(', ')} - ${track.title}${track.version ? ` (${track.version})` : ''}`;
}
