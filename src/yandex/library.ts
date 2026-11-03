/**
 * A Yandex Music library turned into crossfade's library format: liked
 * tracks, your playlists and liked albums. Liked artists are left out on
 * purpose, and so are podcasts and audiobooks, which YouTube Music does not
 * have as songs.
 */

import { type Album, FORMAT, FORMAT_VERSION, type Library, type Like, type Playlist, type Track, checkLibrary } from '../library.ts';
import type { RawAlbum, RawTrack, TrackRef, YandexMusic } from './client.ts';

export interface ReadResult {
  library: Library;
  /** Ids of liked or playlist tracks that are podcasts, audiobooks and the like. */
  notMusic: string[];
  /** Ids of tracks a like or a playlist points to that Yandex no longer gives. */
  gone: string[];
}

export async function readLibrary(
  yandex: YandexMusic,
  now: () => number,
  progress: (message: string) => void = () => {},
): Promise<ReadResult> {
  const { uid } = await yandex.account();

  const likes = await yandex.likedTracks(uid);
  progress(`${likes.length} liked tracks`);
  const list = await yandex.playlists(uid);
  const playlists = [];
  for (const { kind } of list) {
    if (typeof kind === 'number') {
      playlists.push(await yandex.playlist(uid, kind));
      progress(`playlist ${playlists.length} of ${list.length}`);
    }
  }
  const likedAlbums = await yandex.likedAlbums(uid);
  progress(`${likedAlbums.length} liked albums`);

  // Playlists usually come with their tracks; the rest are asked for by id,
  // as "track:album", which is how Yandex wants them.
  const known = new Map<string, RawTrack>();
  for (const ref of playlists.flatMap(playlist => playlist.tracks ?? [])) {
    if (ref.track?.id !== undefined) known.set(String(ref.track.id), ref.track);
  }
  const wanted = new Map<string, string>();
  for (const ref of [...likes, ...playlists.flatMap(playlist => playlist.tracks ?? [])]) {
    const id = refId(ref);
    if (id && !known.has(id)) wanted.set(id, ref.albumId === undefined ? id : `${id}:${ref.albumId}`);
  }
  for (const track of await yandex.tracks([...wanted.values()], done => progress(`tracks ${done} of ${wanted.size}`))) {
    if (track.id !== undefined) known.set(String(track.id), track);
  }

  const tracks = new Map<string, Track>();
  const notMusic = new Set<string>();
  const gone = new Set<string>();
  /** The id of a referenced track that goes into the library, or undefined if it does not. */
  const use = (ref: TrackRef): string | undefined => {
    const id = refId(ref);
    if (!id) return undefined;
    const raw = known.get(id);
    const track = raw && toTrack(id, raw);
    if (!raw || !track) {
      gone.add(id);
    } else if (raw.type !== undefined && raw.type !== 'music') {
      notMusic.add(id);
    } else {
      tracks.set(id, track);
      return id;
    }
    return undefined;
  };

  const liked: Like[] = likes.flatMap(ref => {
    const track = use(ref);
    return track ? [defined({ track, likedAt: isoDate(ref.timestamp) })] : [];
  });
  const ownPlaylists: Playlist[] = playlists.map(playlist =>
    defined({
      id: String(playlist.kind),
      title: playlist.title?.trim() || `Playlist ${playlist.kind}`,
      description: playlist.description?.trim() || undefined,
      tracks: (playlist.tracks ?? []).flatMap(ref => use(ref) ?? []),
    }),
  );
  const albums: Album[] = likedAlbums.flatMap(({ album, timestamp }) => {
    const converted = album && toAlbum(album);
    return converted ? [defined({ ...converted, likedAt: isoDate(timestamp) })] : [];
  });

  const library = checkLibrary({
    format: FORMAT,
    version: FORMAT_VERSION,
    source: 'yandex-music',
    exportedAt: new Date(now()).toISOString(),
    tracks: [...tracks.values()],
    liked,
    playlists: ownPlaylists,
    albums,
  });
  return { library, notMusic: [...notMusic], gone: [...gone] };
}

function refId(ref: TrackRef): string | undefined {
  const id = ref.id ?? ref.track?.id;
  return id === undefined ? undefined : String(id);
}

function toTrack(id: string, raw: RawTrack): Track | undefined {
  const title = raw.title?.trim();
  if (!title) return undefined;
  const artists = names(raw.artists);
  const album = raw.albums?.[0];
  return defined({
    id,
    title,
    version: raw.version?.trim() || undefined,
    // A track someone uploaded has the artist they typed in instead.
    artists: artists.length > 0 || !raw.ugcArtistName?.trim() ? artists : [raw.ugcArtistName.trim()],
    album: album?.title?.trim() || undefined,
    year: positive(album?.year),
    durationMs: positive(raw.durationMs),
    isrc: isrc(raw.isrc),
  });
}

function toAlbum(raw: RawAlbum): Omit<Album, 'likedAt'> | undefined {
  const title = raw.title?.trim();
  if (raw.id === undefined || !title) return undefined;
  return defined({
    id: String(raw.id),
    title,
    artists: names(raw.artists),
    year: positive(raw.year),
    trackCount: positive(raw.trackCount),
  });
}

function names(artists: { name?: string }[] = []): string[] {
  return artists.map(artist => artist.name?.trim() ?? '').filter(Boolean);
}

function positive(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value as number) > 0 ? value : undefined;
}

/** ISRCs are written with and without hyphens, in either case; the library keeps the bare 12 characters. */
function isrc(value: string | undefined): string | undefined {
  const bare = value?.replace(/-/g, '').toUpperCase();
  return bare && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(bare) ? bare : undefined;
}

function isoDate(value: string | undefined): string | undefined {
  const time = value === undefined ? Number.NaN : Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** The object without its undefined fields, so that a file never says "version": undefined. */
function defined<T extends object>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}
