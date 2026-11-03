/**
 * How sure crossfade is that a track found on YouTube Music is the track
 * from the library: a value from 0 to 1, and the reasons behind it, which
 * are shown to the person checking a doubtful match.
 *
 * Title and artists carry the score; neither can make up for the other, so a
 * cover with the same title and a stranger's name scores low. Version notes
 * and the duration then lower it: a live recording or a remix is not the
 * track that was liked, and a minute's difference in length says the same.
 */

import type { Track } from './library.ts';
import { artistSimilarity, similarity } from './similarity.ts';
import { key, parseTitle, type Version } from './text.ts';

/** A track found on YouTube Music. */
export interface Candidate {
  /** The YouTube video id. */
  id: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  /** A song is the audio release; a video is a music video or an upload, played as video. */
  kind?: 'song' | 'video';
}

export interface Score {
  /** 0 to 1: how sure crossfade is that the candidate is the track. */
  value: number;
  /** What the value is made of, in words. */
  reasons: string[];
}

/** The same recording released again: no reason to doubt the match. */
const SAME_RECORDING: ReadonlySet<Version> = new Set(['remaster']);
/** The same recording cut to another length: a small doubt, and the duration check judges the rest. */
const OTHER_LENGTH: ReadonlySet<Version> = new Set(['edit', 'extended']);
/** Any other note on one side only: a different recording. */
const OTHER_RECORDING = 0.5;

/**
 * Edit distance rarely falls to nothing between unrelated names - Кино and
 * Би-2 come out 25% alike - so similarities up to this count as nothing in
 * common, and the rest is stretched back to 0-1.
 */
const UNRELATED = 0.4;

/**
 * Other artists, but the same title and the same length to the second: a
 * cover is rarely that, while the same recording credited differently - to
 * Viktor Tsoi rather than Kino - often is. Enough doubt to ask.
 */
const CREDITED_DIFFERENTLY = 0.5;

/** Without artists on one side only the title is left, and a title alone is never sure. */
const TITLE_ONLY_CAP = 0.7;

/** Words that YouTube adds to channel names: "Queen Official", "Queen - Topic", "KinoVEVO". */
const CHANNEL_WORDS = new Set(['official', 'topic', 'vevo']);

export function score(track: Track, candidate: Candidate): Score {
  if (track.isrc && track.isrc === candidate.isrc) {
    return { value: 1, reasons: ['same ISRC'] };
  }
  const reasons: string[] = [];
  const ours = parseTitle(track.title, track.version);
  const theirs = parseTitle(candidate.title);
  const ourArtists = track.artists.map(key).filter(Boolean);
  const theirArtists = candidate.artists.map(channelName).filter(Boolean);

  // Videos are often titled "Artist - Title".
  const title = Math.max(
    similarity(ours.name, theirs.name),
    similarity(ours.name, withoutArtist(theirs.name, ourArtists)),
  );
  reasons.push(`title ${percent(title)}`);

  let value: number;
  let strangers = false;
  if (ourArtists.length === 0 || theirArtists.length === 0) {
    value = Math.min(related(title), TITLE_ONLY_CAP);
    reasons.push('no artists to compare');
  } else {
    const artists = artistSimilarity(ourArtists, theirArtists);
    reasons.push(`artists ${percent(artists)}`);
    value = related(title) ** 0.6 * related(artists) ** 0.4;
    strangers = related(artists) === 0;
  }

  const sameVersion = versions(ours.versions, theirs.versions, reasons);
  const sameLength = duration(track.durationMs, candidate.durationMs, reasons);
  value *= sameVersion * sameLength;

  if (strangers && title >= 0.9 && sameVersion === 1 && sameLength === 1) {
    value = Math.max(value, CREDITED_DIFFERENTLY);
    reasons.push('other artists, but the same title and length');
  }

  if (track.album && candidate.album && similarity(key(track.album), key(candidate.album)) >= 0.9) {
    value = Math.min(1, value + 0.05);
    reasons.push('same album');
  }
  return { value: Math.round(value * 1000) / 1000, reasons };
}

function related(similarity: number): number {
  return Math.max(0, (similarity - UNRELATED) / (1 - UNRELATED));
}

function versions(ours: Version[], theirs: Version[], reasons: string[]): number {
  let factor = 1;
  const check = (version: Version, other: Version[], where: string) => {
    if (other.includes(version) || SAME_RECORDING.has(version)) {
      return;
    }
    factor *= OTHER_LENGTH.has(version) ? 0.9 : OTHER_RECORDING;
    reasons.push(`"${version}" only ${where}`);
  };
  ours.forEach(version => check(version, theirs, 'in the library'));
  theirs.forEach(version => check(version, ours, 'on YouTube Music'));
  return factor;
}

function duration(ours: number | undefined, theirs: number | undefined, reasons: string[]): number {
  if (ours === undefined || theirs === undefined) {
    reasons.push('duration unknown');
    return 0.95;
  }
  const seconds = Math.round(Math.abs(ours - theirs) / 1000);
  if (seconds <= 3) {
    reasons.push('same duration');
    return 1;
  }
  reasons.push(`duration differs by ${seconds} s`);
  if (seconds <= 10) return 0.9;
  if (seconds <= 30) return 0.7;
  return 0.4;
}

function channelName(name: string): string {
  return key(name)
    .split(' ')
    .filter(word => !CHANNEL_WORDS.has(word))
    .map(word => (word.length > 4 && word.endsWith('vevo') ? word.slice(0, -4) : word))
    .join(' ');
}

/** The title without an artist's name at its start or end, if it has one there. */
function withoutArtist(title: string, artists: string[]): string {
  for (const artist of artists) {
    if (title.startsWith(`${artist} `)) return title.slice(artist.length + 1);
    if (title.endsWith(` ${artist}`)) return title.slice(0, -artist.length - 1);
  }
  return title;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
