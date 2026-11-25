import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CredentialStore } from '../src/credentials.ts';
import type { Library } from '../src/library.ts';
import type { Matches } from '../src/matches.ts';
import { describeProgress, nextStep, type Progress, status } from '../src/status.ts';

const LIBRARY: Library = {
  format: 'crossfade-library',
  version: 1,
  source: 'yandex-music',
  exportedAt: '2026-11-03T18:00:00Z',
  tracks: [
    { id: '1', title: 'Группа крови', artists: ['Кино'] },
    { id: '2', title: 'Прованс', artists: ['Ёлка'] },
    { id: '3', title: 'Демо', artists: ['Мой друг'] },
  ],
  liked: [{ track: '1' }, { track: '2' }],
  playlists: [{ id: '1003', title: 'Дорога', tracks: ['3'] }],
  albums: [{ id: '55', title: 'Группа крови', artists: ['Кино'], year: 1988 }],
};

const match = {
  candidate: { id: 'k1', title: 'Группа крови', artists: ['Кино'] },
  score: { value: 1, reasons: [] },
};
const MATCHES: Matches = {
  format: 'crossfade-matches',
  version: 1,
  library: { source: 'yandex-music', exportedAt: '2026-11-03T18:00:00Z' },
  tracks: {
    '1': { status: 'matched', match, why: 'a sure match' },
    '2': { status: 'review', candidates: [], why: 'not sure enough' },
    '3': { status: 'missing', candidates: [], why: 'no result is close enough' },
    // A track the library no longer has, from an earlier export: not counted.
    '9': { status: 'matched', match, why: 'a sure match' },
  },
  albums: {
    '55': {
      status: 'matched',
      match: {
        candidate: {
          browseId: 'MPREb_k',
          playlistId: 'OLAK5uy_k',
          title: 'Группа крови',
          artists: ['Кино'],
        },
        score: { value: 1, reasons: [] },
      },
      why: 'a sure match',
    },
  },
};

const nobody = { 'yandex-music': false, 'youtube-music': false };
const both = { 'yandex-music': true, 'youtube-music': true };

describe('the next step', () => {
  test('follows the order of the move', () => {
    const steps: [Progress, string][] = [
      [{ signedIn: nobody }, 'crossfade login yandex-music'],
      [{ signedIn: { ...nobody, 'yandex-music': true } }, 'crossfade export'],
      [{ signedIn: both, library: LIBRARY }, 'crossfade match'],
      [
        { signedIn: both, library: LIBRARY, matches: { ...MATCHES, albums: {} } },
        'crossfade match',
      ],
      [{ signedIn: both, library: LIBRARY, matches: MATCHES }, 'crossfade review'],
    ];
    for (const [progress, step] of steps) assert.equal(nextStep(progress), step);
  });

  test('YouTube Music sign-in is asked for only when the matches are ready', () => {
    const reviewed: Matches = {
      ...MATCHES,
      tracks: {
        ...MATCHES.tracks,
        '2': {
          status: 'missing',
          candidates: [],
          why: 'none of the results is the track',
          by: 'you',
        },
      },
    };
    assert.equal(
      nextStep({
        signedIn: { ...both, 'youtube-music': false },
        library: LIBRARY,
        matches: reviewed,
      }),
      'crossfade login youtube-music',
    );
    assert.equal(
      nextStep({
        signedIn: { ...both, 'youtube-music': 'damaged' },
        library: LIBRARY,
        matches: reviewed,
      }),
      'crossfade login youtube-music',
    );
    assert.equal(
      nextStep({ signedIn: both, library: LIBRARY, matches: reviewed }),
      'crossfade import --dry-run, then crossfade import',
    );
  });
});

describe('crossfade status', () => {
  test('says what is there and what is next', () => {
    assert.deepEqual(
      describeProgress(
        { signedIn: { ...both, 'youtube-music': false }, library: LIBRARY, matches: MATCHES },
        'library.json',
        'matches.json',
      ),
      [
        'Yandex Music: signed in',
        'YouTube Music: not signed in',
        'library.json: 3 tracks (2 liked), 1 playlist, 1 album, exported from yandex-music on 2026-11-03',
        'matches.json: 3 of 3 tracks decided - 1 matched, 1 to review, 1 not found; 1 of 1 album matched',
        'Next: crossfade review',
      ],
    );
  });

  test('before anything is done', () => {
    assert.deepEqual(describeProgress({ signedIn: nobody }, 'library.json', 'matches.json'), [
      'Yandex Music: not signed in',
      'YouTube Music: not signed in',
      'library.json: not exported yet',
      'Next: crossfade login yandex-music',
    ]);
  });

  test('reads the files and the sign-ins, and shows no secret', async (t) => {
    const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const store = new CredentialStore(join(base, 'config'));
    await store.save('yandex-music', { token: 'y0_secret-token' });
    const deps = { store, clock: { now: () => 0, sleep: async () => {} }, fetch };
    const libraryFile = join(base, 'library.json');
    const matchesFile = join(base, 'matches.json');
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };

    assert.equal(await status(libraryFile, matchesFile, io, deps), 0);
    assert.deepEqual(out, [
      'Yandex Music: signed in',
      'YouTube Music: not signed in',
      `${libraryFile}: not exported yet`,
      'Next: crossfade export',
    ]);

    await writeFile(libraryFile, JSON.stringify(LIBRARY));
    out.length = 0;
    assert.equal(await status(libraryFile, matchesFile, io, deps), 0);
    assert.equal(out.at(-2), `${matchesFile}: not matched yet`);
    assert.equal(out.at(-1), 'Next: crossfade match');
    assert.ok(!out.join('\n').includes('secret'));

    await writeFile(matchesFile, '{"name": "my notes"}');
    assert.equal(await status(libraryFile, matchesFile, io, deps), 1);
    assert.equal(err[0], 'Not a crossfade matches file: "format" should be "crossfade-matches"');
  });
});
