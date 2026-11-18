/**
 * Writing the files crossfade makes - the library, the matches, a report - in one
 * step: the text goes to a draft next to the file and the draft is moved
 * over it, so an interrupted run leaves the previous file, never half of a
 * new one. Only you can read them: they show what you listen to.
 */

import { rename, rm, writeFile } from 'node:fs/promises';

export async function saveJson(file: string, data: unknown): Promise<void> {
  await saveText(file, `${JSON.stringify(data, null, 2)}\n`);
}

export async function saveText(file: string, text: string): Promise<void> {
  const draft = `${file}.${process.pid}.tmp`;
  await rm(draft, { force: true });
  await writeFile(draft, text, { mode: 0o600, flag: 'wx' });
  await rename(draft, file);
}
