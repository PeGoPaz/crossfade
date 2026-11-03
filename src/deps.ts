/**
 * What the commands need from the outside world, passed in so that tests
 * can give them a fake clock, a scripted service and a folder of their own.
 */

import { CredentialStore } from './credentials.ts';
import { type Clock, systemClock } from './requests.ts';

export interface Deps {
  store: CredentialStore;
  clock: Clock;
  fetch: typeof globalThis.fetch;
}

export function defaultDeps(): Deps {
  return { store: new CredentialStore(), clock: systemClock, fetch: globalThis.fetch };
}
