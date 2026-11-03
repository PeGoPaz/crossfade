/**
 * `crossfade login <service>`: signs in and keeps what the service gave in
 * the credential store.
 */

import { text } from 'node:stream/consumers';

import type { Io } from './cli.ts';
import type { Service } from './credentials.ts';
import { type Deps, defaultDeps } from './deps.ts';
import { HttpError, Requests } from './requests.ts';
import { SignInError, requestCode, waitForToken } from './yandex/signin.ts';
import { SessionError, accountName, parseHeaders } from './ytmusic/session.ts';

/** Everything typed or piped in, up to the end of the input. */
export type ReadInput = () => Promise<string>;

export async function login(
  service: Service,
  io: Io,
  deps: Deps = defaultDeps(),
  readInput: ReadInput = () => text(process.stdin),
): Promise<number> {
  return service === 'yandex-music' ? loginYandex(io, deps) : loginYouTube(io, deps, readInput);
}

async function loginYandex(io: Io, deps: Deps): Promise<number> {
  const service = 'yandex-music';
  const requests = new Requests({ spacingMs: 0, fetch: deps.fetch, clock: deps.clock });
  try {
    const code = await requestCode(requests, deps.clock);
    const minutes = Math.round((code.expiresAt - deps.clock.now()) / 60_000);
    io.out(`Open ${code.verificationUrl} where you are signed in to Yandex, and enter the code ${code.userCode}`);
    io.out(`The code works for ${minutes} min. Waiting...`);
    const token = await waitForToken(requests, deps.clock, code);
    await deps.store.save(service, token);
    io.out(`Signed in to Yandex Music. crossfade keeps the token in ${deps.store.path(service)}`);
    return 0;
  } catch (error) {
    if (error instanceof SignInError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

async function loginYouTube(io: Io, deps: Deps, readInput: ReadInput): Promise<number> {
  const service = 'youtube-music';
  io.err(
    [
      'In Firefox, open music.youtube.com where you are signed in and press F12. In the Network tab,',
      'click a POST request to music.youtube.com/youtubei/v1/..., then right-click it: Copy Value > Copy Request Headers.',
      'Paste them here and press Ctrl+D, or run instead: pbpaste | crossfade login youtube-music',
      'They hold your Google session: paste them only here, never into a chat or an issue.',
    ].join('\n'),
  );
  try {
    const session = parseHeaders(await readInput());
    const requests = new Requests({ spacingMs: 0, fetch: deps.fetch, clock: deps.clock });
    const name = await accountName(requests, session, () => deps.clock.now());
    await deps.store.save(service, session);
    io.out(`Signed in to YouTube Music as ${name}. crossfade keeps the cookie in ${deps.store.path(service)}`);
    return 0;
  } catch (error) {
    if (error instanceof SessionError || error instanceof HttpError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}
