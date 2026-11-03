import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CredentialStore, configDir, redact } from '../src/credentials.ts';

const unix = process.platform !== 'win32';

async function store(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return new CredentialStore(join(base, 'crossfade'));
}

describe('CredentialStore', () => {
  test('keeps what it is given', async t => {
    const credentials = await store(t);
    await credentials.save('yandex-music', { token: 'y0_secret-token', uid: 42 });
    assert.deepEqual(await credentials.load('yandex-music'), { token: 'y0_secret-token', uid: 42 });
  });

  test('in a folder and a file only the user can open', { skip: !unix }, async t => {
    const credentials = await store(t);
    await credentials.save('yandex-music', { token: 'y0_secret-token' });
    assert.equal((await stat(credentials.dir)).mode & 0o777, 0o700);
    assert.equal((await stat(credentials.path('yandex-music'))).mode & 0o777, 0o600);
  });

  test('replaces a saved file whole and leaves nothing behind', async t => {
    const credentials = await store(t);
    await credentials.save('youtube-music', { cookie: 'first' });
    await credentials.save('youtube-music', { cookie: 'second' });
    assert.deepEqual(await credentials.load('youtube-music'), { cookie: 'second' });
    assert.deepEqual(await readdir(credentials.dir), ['youtube-music.json']);
  });

  test('a service you have not signed in to', async t => {
    const credentials = await store(t);
    assert.equal(await credentials.load('youtube-music'), undefined);
  });

  test('refuses a file other users can read, and says how to fix it', { skip: !unix }, async t => {
    const credentials = await store(t);
    await credentials.save('yandex-music', { token: 'y0_secret-token' });
    const file = credentials.path('yandex-music');
    await chmod(file, 0o644);
    await assert.rejects(credentials.load('yandex-music'), {
      message: `${file} can be read by other users, so crossfade will not use it. Run: chmod 600 "${file}"`,
    });
    await chmod(file, 0o600);
    assert.deepEqual(await credentials.load('yandex-music'), { token: 'y0_secret-token' });
  });

  test('a damaged file asks to sign in again', async t => {
    const credentials = await store(t);
    await credentials.save('yandex-music', {});
    await writeFile(credentials.path('yandex-music'), '{"token": ', { mode: 0o600 });
    await assert.rejects(credentials.load('yandex-music'), /is damaged\. Sign in again: crossfade login yandex-music$/);
  });

  test('forgets a service', async t => {
    const credentials = await store(t);
    await credentials.save('yandex-music', { token: 'y0_secret-token' });
    assert.equal(await credentials.remove('yandex-music'), true);
    assert.equal(await credentials.load('yandex-music'), undefined);
    assert.equal(await credentials.remove('yandex-music'), false);
  });
});

describe('configDir', () => {
  test('CROSSFADE_HOME first, then XDG_CONFIG_HOME, then the platform default', () => {
    const home = '/home/vlad';
    assert.equal(configDir({ CROSSFADE_HOME: '/tmp/cf', XDG_CONFIG_HOME: '/x' }, 'linux', home), '/tmp/cf');
    assert.equal(configDir({ XDG_CONFIG_HOME: '/x' }, 'linux', home), join('/x', 'crossfade'));
    assert.equal(configDir({}, 'darwin', home), join(home, '.config', 'crossfade'));
    assert.equal(configDir({ APPDATA: 'C:\\Users\\vlad\\AppData\\Roaming' }, 'win32', home), join('C:\\Users\\vlad\\AppData\\Roaming', 'crossfade'));
  });
});

describe('redact', () => {
  test('hides every copy of every secret', () => {
    assert.equal(
      redact('Authorization: OAuth y0_secret-token; again y0_secret-token', ['y0_secret-token']),
      'Authorization: OAuth [hidden]; again [hidden]',
    );
  });

  test('a secret that contains another is hidden whole', () => {
    assert.equal(redact('SAPISID=abcdefgh12345678', ['abcdefgh', 'abcdefgh12345678']), 'SAPISID=[hidden]');
  });

  test('leaves short or missing values alone', () => {
    assert.equal(redact('a token', ['', 'a', undefined]), 'a token');
  });
});
