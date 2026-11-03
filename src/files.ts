/**
 * Writing the files crossfade makes - the library and the matches - in one
 * step: the text goes to a draft next to the file and the draft is moved
 * over it, so an interrupted run leaves the previous file, never half of a
 * new one. Only you can read them: they show what you listen to.
 */

import { rename, rm, writeFile } from 'node:fs/promises';

export async function saveJson(file: string, data: unknown): Promise<void> {
  const draft = `${file}.${process.pid}.tmp`;
  await rm(draft, { force: true });
  await writeFile(draft, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(draft, file);
}
