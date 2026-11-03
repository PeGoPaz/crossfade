/**
 * Where the command line keeps what it needs to act as you on each service:
 * one JSON file per service in crossfade's folder in your user's settings,
 * which only your user can read - and crossfade refuses to use a file that
 * others can read, the way ssh refuses a private key left open.
 *
 * The browser extension will keep these in the browser instead.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Service = 'yandex-music' | 'youtube-music';

/**
 * crossfade's settings folder: $CROSSFADE_HOME if set, else crossfade in
 * $XDG_CONFIG_HOME, %APPDATA% on Windows, or ~/.config.
 */
export function configDir(
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
  home: string = homedir(),
): string {
  if (env.CROSSFADE_HOME) return env.CROSSFADE_HOME;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'crossfade');
  if (platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'crossfade');
  return join(home, '.config', 'crossfade');
}

export class CredentialStore {
  readonly dir: string;
  /** Windows has no Unix permissions to check; there the folder is private to the user already. */
  readonly #unixModes: boolean;

  constructor(dir: string = configDir(), platform: string = process.platform) {
    this.dir = dir;
    this.#unixModes = platform !== 'win32';
  }

  path(service: Service): string {
    return join(this.dir, `${service}.json`);
  }

  /** Saves what a service needs, replacing what was there in one step: a crash leaves the old file or the new one, never half of one. */
  async save(service: Service, data: object): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const file = this.path(service);
    const draft = `${file}.${process.pid}.tmp`;
    // Created readable by the owner only, before anything is written to it;
    // a draft left by a crash is not reused, since its mode is not known.
    await rm(draft, { force: true });
    await writeFile(draft, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(draft, file);
  }

  /** What was saved for a service, or undefined if you have not signed in to it. */
  async load<T extends object>(service: Service): Promise<T | undefined> {
    const file = this.path(service);
    let text: string;
    try {
      if (this.#unixModes && ((await stat(file)).mode & 0o077) !== 0) {
        throw new Error(`${file} can be read by other users, so crossfade will not use it. Run: chmod 600 "${file}"`);
      }
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`${file} is damaged. Sign in again: crossfade login ${service}`);
    }
  }

  /** Forgets a service. False if there was nothing to forget. */
  async remove(service: Service): Promise<boolean> {
    try {
      await stat(this.path(service));
    } catch {
      return false;
    }
    await rm(this.path(service));
    return true;
  }
}

/**
 * The text with every secret in it replaced, for anything printed or logged
 * that might contain one. Longer secrets first, so that one containing
 * another is hidden whole. Very short strings are not treated as secrets:
 * hiding every "a" would hide nothing.
 */
export function redact(text: string, secrets: (string | undefined)[]): string {
  return secrets
    .filter((secret): secret is string => secret !== undefined && secret.length >= 8)
    .sort((a, b) => b.length - a.length)
    .reduce((result, secret) => result.split(secret).join('[hidden]'), text);
}
