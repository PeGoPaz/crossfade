/**
 * `crossfade export`: reads your Yandex Music library and saves it as a
 * library file. Progress goes to stderr, the summary to stdout.
 */

import type { Io } from './cli.ts';
import { type Deps, defaultDeps } from './deps.ts';
import { saveJson } from './files.ts';
import { count } from './words.ts';
import { HttpError, Requests } from './requests.ts';
import { YandexAuthError, YandexMusic } from './yandex/client.ts';
import { readLibrary } from './yandex/library.ts';
import type { YandexToken } from './yandex/signin.ts';

/** A few requests a second at most: an export takes about a hundred, and nobody is waiting on each one. */
const SPACING_MS = 250;

export async function exportLibrary(file: string, io: Io, deps: Deps = defaultDeps()): Promise<number> {
  const saved = await deps.store.load<YandexToken>('yandex-music');
  if (!saved) {
    io.err('crossfade is not signed in to Yandex Music. Run: crossfade login yandex-music');
    return 1;
  }
  if (saved.expiresAt <= deps.clock.now()) {
    io.err('The Yandex Music sign-in has expired. Run: crossfade login yandex-music');
    return 1;
  }

  const requests = new Requests({
    spacingMs: SPACING_MS,
    fetch: deps.fetch,
    clock: deps.clock,
    onWait: (ms, reason) => io.err(`Yandex Music: ${reason}; trying again in ${Math.ceil(ms / 1000)} s`),
  });
  let result;
  try {
    io.err('Reading your Yandex Music library...');
    result = await readLibrary(new YandexMusic(requests, saved.token), () => deps.clock.now(), message => io.err(`  ${message}`));
  } catch (error) {
    if (error instanceof YandexAuthError || error instanceof HttpError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }

  await saveJson(file, result.library);

  const { liked, playlists, albums, tracks } = result.library;
  io.out(
    `Saved ${file}: ${count(liked.length, 'liked track')}, ${count(playlists.length, 'playlist')}, ` +
      `${count(albums.length, 'liked album')} (${count(tracks.length, 'track')} in all).`,
  );
  if (result.notMusic.length > 0) {
    io.out(`Left out ${count(result.notMusic.length, 'podcast or audiobook', 'podcasts and audiobooks')}.`);
  }
  if (result.gone.length > 0) {
    io.out(`Left out ${count(result.gone.length, 'track')} Yandex Music no longer has.`);
  }
  for (const { title, reason } of result.unread) {
    io.err(`Could not read the playlist "${title}", so it is not in the file: ${reason}`);
  }
  return 0;
}
