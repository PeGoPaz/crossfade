import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CredentialStore } from '../src/credentials.ts';
import { exportLibrary } from '../src/export.ts';
import { parseLibrary } from '../src/library.ts';
import { LIBRARY, fakeYandex } from './fake-yandex.ts';

const NOW = Date.parse('2026-11-03T13:40:00Z');

async function setup(t: { after: (fn: () => Promise<void>) => void }, routes: Record<string, unknown> = LIBRARY, status = 200) {
  const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const store = new CredentialStore(join(base, 'config'));
  const { fetch } = fakeYandex(routes, status);
  let now = NOW;
  const clock = { now: () => now, sleep: async (ms: number) => void (now += ms) };
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
  const file = join(base, 'library.json');
  const run = () => exportLibrary(file, io, { store, clock, fetch });
  return { store, file, base, out, err, run };
}

describe('crossfade export', () => {
  test('saves the library and sums it up', async t => {
    const { store, file, out, err, run } = await setup(t);
    await store.save('yandex-music', { token: 'y0_made-up-token', expiresAt: NOW + 1000 });
    assert.equal(await run(), 0);

    const library = parseLibrary(await readFile(file, 'utf8'));
    assert.equal(library.liked.length, 2);
    assert.deepEqual(out, [
      `Saved ${file}: 2 liked tracks, 1 playlist, 1 liked album (3 tracks in all).`,
      'Left out 1 podcast or audiobook.',
    ]);
    assert.equal(err[0], 'Reading your Yandex Music library...');
    // Progress counts the likes as Yandex gives them, podcast included.
    assert.ok(err.includes('  3 liked tracks'));
  });

  test('the file is readable by its owner only, and nothing else is left behind', { skip: process.platform === 'win32' }, async t => {
    const { store, file, base, run } = await setup(t);
    await store.save('yandex-music', { token: 'y0_made-up-token', expiresAt: NOW + 1000 });
    await run();
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(base)).sort(), ['config', 'library.json']);
  });

  test('without a sign-in it says how to sign in', async t => {
    const { err, run } = await setup(t);
    assert.equal(await run(), 1);
    assert.deepEqual(err, ['crossfade is not signed in to Yandex Music. Run: crossfade login yandex-music']);
  });

  test('an expired sign-in is not even tried', async t => {
    const { store, err, run } = await setup(t);
    await store.save('yandex-music', { token: 'y0_made-up-token', expiresAt: NOW - 1 });
    assert.equal(await run(), 1);
    assert.deepEqual(err, ['The Yandex Music sign-in has expired. Run: crossfade login yandex-music']);
  });

  test('a sign-in Yandex no longer accepts: nothing is saved', async t => {
    const { store, file, err, run } = await setup(t, LIBRARY, 401);
    await store.save('yandex-music', { token: 'y0_made-up-token', expiresAt: NOW + 1000 });
    assert.equal(await run(), 1);
    assert.match(err.at(-1) ?? '', /Sign in again: crossfade login yandex-music$/);
    await assert.rejects(stat(file), { code: 'ENOENT' });
  });

  test('a playlist that cannot be read is reported, and the rest is saved', async t => {
    const routes = { ...LIBRARY, '/users/42/playlists/list': [...(LIBRARY['/users/42/playlists/list'] as object[]), { kind: 1004, title: 'Сломанный' }] };
    const { store, file, out, err, run } = await setup(t, routes);
    await store.save('yandex-music', { token: 'y0_made-up-token', expiresAt: NOW + 1000 });
    assert.equal(await run(), 0);
    assert.equal(parseLibrary(await readFile(file, 'utf8')).playlists.length, 1);
    assert.match(out[0] ?? '', /1 playlist,/);
    assert.equal(
      err.at(-1),
      'Could not read the playlist "Сломанный", so it is not in the file: GET https://api.music.yandex.net/users/42/playlists/1004: 404 Not Found',
    );
  });
});
