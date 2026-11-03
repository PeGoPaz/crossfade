/**
 * `crossfade login <service>`: signs in and keeps what the service gave in
 * the credential store.
 */

import type { Io } from './cli.ts';
import { CredentialStore, type Service } from './credentials.ts';
import { type Clock, Requests, systemClock } from './requests.ts';
import { SignInError, requestCode, waitForToken } from './yandex/signin.ts';

export interface LoginDeps {
  store: CredentialStore;
  clock: Clock;
  fetch: typeof globalThis.fetch;
}

export function defaultLoginDeps(): LoginDeps {
  return { store: new CredentialStore(), clock: systemClock, fetch: globalThis.fetch };
}

export async function login(service: Service, io: Io, deps: LoginDeps = defaultLoginDeps()): Promise<number> {
  if (service !== 'yandex-music') {
    io.err(`crossfade login ${service} is not written yet - see the roadmap in README.md`);
    return 1;
  }
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
