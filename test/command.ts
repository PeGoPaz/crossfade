import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Starts the crossfade command from the source, the way `npm run crossfade`
 * does, and resolves with what it printed. `.child` is the running process.
 */
export function crossfade(args: string[]) {
  const main = new URL('../src/main.ts', import.meta.url).pathname;
  return promisify(execFile)(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', main, ...args]);
}
