/**
 * What an import would do, worked out before anything is changed: which
 * songs to like, which playlists to create or add to, and what is left out
 * and why. `crossfade import --dry-run` prints it; the import itself carries
 * it out.
 *
 * Nothing already in YouTube Music is added again. A song counts as there
 * if it has the same video id, or if it is the same recording under
 * another id - the album release where the match is the single, say - as
 * judged by the same scoring the matching uses.
 */

import { SURE } from './decide.ts';
import type { Library, Like, Track } from './library.ts';
import type { Matches } from './matches.ts';
import { type Candidate, score } from './score.ts';
import { key } from './text.ts';
import { count } from './words.ts';
import type { YouTubeLibraryContents } from './ytmusic/library.ts';

export interface PlannedLike {
  track: string;
  videoId: string;
}

export interface PlannedPlaylist {
  /** The playlist's id in the library. */
  source: string;
  title: string;
  description?: string;
  /** An existing YouTube Music playlist of the same name, which is added to rather than made again. */
  existing?: string;
  /** Video ids to add, in playlist order. */
  add: string[];
  /** Tracks of the playlist left out because they have no match. */
  unmatched: number;
  /** Tracks of the playlist that are in the existing one already. */
  present: number;
}

export interface PlannedAlbum {
  /** The album's id in the library. */
  source: string;
  title: string;
  /** The album's playlist id on YouTube Music, OLAK...; saving the album takes it. */
  playlistId: string;
}

export interface Plan {
  /** In the order to like them: oldest first, so the newest ends up on top, as on Yandex Music. */
  likes: PlannedLike[];
  alreadyLiked: number;
  playlists: PlannedPlaylist[];
  /** Liked albums to save, matched and not in the library already. */
  albums: PlannedAlbum[];
  /** Liked albums YouTube Music already holds. */
  alreadySaved: number;
  /** Liked albums left out: no match, or no match close enough. */
  albumsNotMatched: number;
  /** Tracks liked or in a playlist that have no match, by why. */
  toReview: number;
  notFound: number;
}

export function planImport(library: Library, matches: Matches, existing: YouTubeLibraryContents): Plan {
  const tracks = new Map(library.tracks.map(track => [track.id, track]));
  const videoOf = (id: string): string | undefined => {
    const entry = matches.tracks[id];
    return entry?.status === 'matched' ? entry.match.candidate.id : undefined;
  };
  const unmatched = new Set<string>();
  const note = (id: string) => {
    if (!videoOf(id)) unmatched.add(id);
  };

  const liked = new Present(existing.liked);
  const likes: PlannedLike[] = [];
  let alreadyLiked = 0;
  for (const like of oldestFirst(library.liked)) {
    const videoId = videoOf(like.track);
    note(like.track);
    if (!videoId) continue;
    if (liked.has(videoId, tracks.get(like.track))) alreadyLiked += 1;
    else likes.push({ track: like.track, videoId });
  }

  const byTitle = new Map(existing.playlists.map(playlist => [key(playlist.title), playlist]));
  const playlists = library.playlists.map(playlist => {
    const same = byTitle.get(key(playlist.title));
    const inside = new Present(same?.items ?? []);
    const planned: PlannedPlaylist = { source: playlist.id, title: playlist.title, add: [], unmatched: 0, present: 0 };
    if (playlist.description) planned.description = playlist.description;
    if (same) planned.existing = same.id;
    for (const id of playlist.tracks) {
      const videoId = videoOf(id);
      note(id);
      if (!videoId) planned.unmatched += 1;
      else if (inside.has(videoId, tracks.get(id))) planned.present += 1;
      else planned.add.push(videoId);
    }
    return planned;
  });

  const statuses = [...unmatched].map(id => matches.tracks[id]?.status);

  const saved = new Set(existing.albums.map(album => album.id));
  const albums: PlannedAlbum[] = [];
  let alreadySaved = 0;
  let albumsNotMatched = 0;
  for (const album of library.albums) {
    const entry = matches.albums?.[album.id];
    if (entry?.status !== 'matched' || !entry.match.candidate.playlistId) {
      albumsNotMatched += 1;
      continue;
    }
    const { browseId, playlistId } = entry.match.candidate;
    // Saved albums are read back by their browse id, MPRE..., which the match keeps.
    if (saved.has(browseId)) alreadySaved += 1;
    else albums.push({ source: album.id, title: album.title, playlistId });
  }

  return {
    likes,
    alreadyLiked,
    playlists,
    albums,
    alreadySaved,
    albumsNotMatched,
    // A track never matched counts as to review: `crossfade match` has yet to see it.
    toReview: statuses.filter(status => status !== 'missing').length,
    notFound: statuses.filter(status => status === 'missing').length,
  };
}

/** The plan in words, as `crossfade import --dry-run` prints it. */
export function describePlan(plan: Plan): string[] {
  const lines = [`Would like ${count(plan.likes.length, 'song')} (${plan.alreadyLiked} liked already).`];
  if (plan.albums.length + plan.alreadySaved + plan.albumsNotMatched > 0) {
    const aside = plan.albumsNotMatched > 0 ? `, ${plan.albumsNotMatched} without a match` : '';
    lines.push(`Would save ${count(plan.albums.length, 'album')} (${plan.alreadySaved} saved already${aside}).`);
  }
  for (const playlist of plan.playlists) {
    const notes = [
      playlist.present > 0 ? `${playlist.present} there already` : '',
      playlist.unmatched > 0 ? `${playlist.unmatched} without a match` : '',
    ].filter(Boolean);
    const aside = notes.length > 0 ? ` (${notes.join(', ')})` : '';
    lines.push(
      playlist.existing
        ? `Would add ${count(playlist.add.length, 'song')} to your playlist "${playlist.title}"${aside}.`
        : `Would create the playlist "${playlist.title}" with ${count(playlist.add.length, 'song')}${aside}.`,
    );
  }
  if (plan.toReview + plan.notFound > 0) {
    lines.push(`Left out: ${count(plan.toReview, 'track')} to review (crossfade review), ${plan.notFound} not on YouTube Music.`);
  }
  return lines;
}

/** Likes by when they were made, oldest first. Yandex lists likes newest first, so likes without a date are taken in reverse. */
function oldestFirst(likes: Like[]): Like[] {
  return likes
    .map((like, i) => ({ like, at: like.likedAt ? Date.parse(like.likedAt) : -i }))
    .sort((a, b) => a.at - b.at)
    .map(({ like }) => like);
}

/**
 * What a list already holds, asked "is this song there?" Looking for the
 * same recording under another id scores the track against the list's
 * songs; only songs within a few seconds of its length are scored, which
 * keeps a thousand tracks against a thousand songs quick.
 */
class Present {
  readonly #ids: Set<string>;
  readonly #songs: Candidate[];

  constructor(songs: Candidate[]) {
    this.#ids = new Set(songs.map(song => song.id));
    this.#songs = songs;
  }

  has(videoId: string, track: Track | undefined): boolean {
    if (this.#ids.has(videoId)) return true;
    if (!track) return false;
    const near = (song: Candidate) =>
      track.durationMs === undefined || song.durationMs === undefined || Math.abs(track.durationMs - song.durationMs) <= 5000;
    return this.#songs.some(song => near(song) && score(track, song).value >= SURE);
  }
}

/** What carrying out a plan needs from YouTube Music. */
export interface Writer {
  like(videoId: string): Promise<void>;
  createPlaylist(title: string, description: string, videoIds: string[]): Promise<string>;
  addToPlaylist(playlistId: string, videoIds: string[]): Promise<void>;
  saveAlbum(playlistId: string): Promise<void>;
}

/**
 * Does what the plan says, likes first. Nothing records what was done: a
 * run that stops is started again, the plan is made anew from what YouTube
 * Music holds by then, and what was done is skipped.
 */
export async function carryOut(plan: Plan, writer: Writer, progress: (message: string) => void = () => {}): Promise<void> {
  for (const [i, { videoId }] of plan.likes.entries()) {
    await writer.like(videoId);
    if ((i + 1) % 25 === 0 || i + 1 === plan.likes.length) progress(`liked ${i + 1} of ${plan.likes.length}`);
  }
  for (const album of plan.albums) {
    await writer.saveAlbum(album.playlistId);
    progress(`saved \"${album.title}\"`);
  }
  for (const playlist of plan.playlists) {
    if (playlist.add.length === 0) continue;
    if (playlist.existing) {
      await writer.addToPlaylist(playlist.existing, playlist.add);
      progress(`added ${count(playlist.add.length, 'song')} to "${playlist.title}"`);
    } else {
      await writer.createPlaylist(playlist.title, playlist.description ?? '', playlist.add);
      progress(`made "${playlist.title}" with ${count(playlist.add.length, 'song')}`);
    }
  }
}
