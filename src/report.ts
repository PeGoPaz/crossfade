/**
 * `crossfade report`: what could not be moved, and why - the tracks
 * YouTube Music does not have, the ones still waiting for a decision, and
 * the albums that could not be matched. Each track says where it is in the
 * library, so you know what a gap in a playlist is.
 *
 * With --csv the same list is also saved as a table, with a YouTube Music
 * search link for each row, to work through by hand in a spreadsheet.
 */

import { readFile } from 'node:fs/promises';

import type { Io } from './cli.ts';
import { toCsv } from './csv.ts';
import { saveText } from './files.ts';
import { type Library, type Track, type Album, parseLibrary } from './library.ts';
import { type Matches, parseMatches } from './matches.ts';
import { count } from './words.ts';

/** Where each track is in the library: "liked" and the titles of the playlists it is in. */
function placesOf(library: Library): Map<string, string[]> {
  const places = new Map<string, string[]>();
  const add = (track: string, place: string) => places.set(track, [...(places.get(track) ?? []), place]);
  for (const like of library.liked) add(like.track, 'liked');
  for (const playlist of library.playlists) {
    for (const track of new Set(playlist.tracks)) add(track, playlist.title);
  }
  return places;
}

export const CSV_HEADER = ['what', 'artists', 'title', 'version', 'album or year', 'length', 'in', 'closest on YouTube Music', 'how close', 'search YouTube Music'];

/** The tracks and albums that were not moved, one row each, under CSV_HEADER. */
export function gapRows(library: Library, matches: Matches): string[][] {
  const places = placesOf(library);
  const closestOf = (closest: { candidate: { artists: string[]; title: string }; score: { value: number } } | undefined) =>
    closest ? [`${closest.candidate.artists.join(', ')} - ${closest.candidate.title}`, `${Math.round(closest.score.value * 100)}%`] : ['', ''];
  const rows: string[][] = [];
  for (const track of library.tracks) {
    const entry = matches.tracks[track.id];
    if (entry?.status === 'matched') continue;
    rows.push([
      !entry ? 'not matched yet' : entry.status === 'review' ? 'to review' : 'not on YouTube Music',
      track.artists.join(', '),
      track.title,
      track.version ?? '',
      track.album ?? '',
      track.durationMs === undefined ? '' : length(track.durationMs),
      (places.get(track.id) ?? []).join('; '),
      ...closestOf(entry?.candidates[0]),
      searchLink([track.artists[0], track.title]),
    ]);
  }
  for (const album of library.albums) {
    const decision = matches.albums?.[album.id];
    if (decision?.status === 'matched') continue;
    rows.push([
      decision ? 'album not on YouTube Music' : 'album not matched yet',
      album.artists.join(', '),
      album.title,
      '',
      album.year === undefined ? '' : String(album.year),
      '',
      'liked albums',
      ...closestOf(decision?.candidates[0]),
      searchLink([album.artists[0], album.title]),
    ]);
  }
  return rows;
}

export function describeGaps(library: Library, matches: Matches): string[] {
  const places = placesOf(library);
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

  const missingAlbums = library.albums.filter(album => matches.albums?.[album.id]?.status === 'missing');
  if (missingAlbums.length > 0) {
    lines.push(`Albums not on YouTube Music (${missingAlbums.length}):`);
    for (const album of missingAlbums) {
      lines.push(`  ${albumName(album)}`);
      const entry = matches.albums?.[album.id];
      const closest = entry?.status === 'missing' ? entry.candidates[0] : undefined;
      if (closest) {
        const { candidate, score } = closest;
        lines.push(`    closest: ${candidate.artists.join(', ')} - ${candidate.title}, ${Math.round(score.value * 100)}%: ${score.reasons.join(', ')}`);
      }
    }
  }
  const unmatchedAlbums = library.albums.filter(album => !matches.albums?.[album.id]);
  if (unmatchedAlbums.length > 0) {
    lines.push(`Albums not matched yet (${unmatchedAlbums.length}). Run crossfade match.`);
  }
  return lines.length > 0 ? lines : ['Every track of the library has a match on YouTube Music.'];
}

export async function report(libraryFile: string, matchesFile: string, io: Io, csvFile?: string): Promise<number> {
  try {
    const library = parseLibrary(await readFile(libraryFile, 'utf8'));
    const matches = parseMatches(await readFile(matchesFile, 'utf8'));
    for (const line of describeGaps(library, matches)) io.out(line);
    if (csvFile !== undefined) {
      const rows = gapRows(library, matches);
      await saveText(csvFile, toCsv([CSV_HEADER, ...rows]));
      io.out(`Saved ${csvFile}: ${count(rows.length, 'track or album', 'tracks and albums')} to find by hand.`);
    }
    return 0;
  } catch (error) {
    io.err((error as Error).message);
    return 1;
  }
}

/** 3:05 */
function length(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function searchLink(words: (string | undefined)[]): string {
  return `https://music.youtube.com/search?q=${encodeURIComponent(words.filter(Boolean).join(' '))}`;
}

function name(track: Track): string {
  return `${track.artists.join(', ')} - ${track.title}${track.version ? ` (${track.version})` : ''}`;
}

function albumName(album: Album): string {
  return `${album.artists.join(', ')} - ${album.title}${album.year ? ` (${album.year})` : ''}`;
}
