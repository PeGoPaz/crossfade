import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CredentialStore } from '../src/credentials.ts';
import { type ImportParts, importMatches } from '../src/import.ts';
import type { Library } from '../src/library.ts';
import type { Matches } from '../src/matches.ts';
import { type Writer, carryOut, describePlan, planImport } from '../src/plan.ts';
import type { Candidate } from '../src/score.ts';
import type { YouTubeLibraryContents } from '../src/ytmusic/library.ts';

const song = (id: string, title: string, artists: string[], durationMs: number): Candidate => ({ id, title, artists, durationMs, kind: 'song' });

const kino = { id: '1', title: 'Группа крови', artists: ['Кино'], durationMs: 285_000 };
const queen = { id: '2', title: 'Bohemian Rhapsody', artists: ['Queen'], durationMs: 355_000 };
const yolka = { id: '3', title: 'Прованс', artists: ['Ёлка'], durationMs: 205_000 };
const nirvana = { id: '4', title: 'Smells Like Teen Spirit', version: 'Live', artists: ['Nirvana'], durationMs: 318_000 };
const demo = { id: '5', title: 'Демо', artists: ['Мой друг'], durationMs: 180_000 };

const LIBRARY: Library = {
  format: 'crossfade-library',
  version: 1,
  source: 'yandex-music',
  exportedAt: '2026-11-03T17:00:00Z',
  tracks: [kino, queen, yolka, nirvana, demo],
  // As Yandex lists them: newest first.
  liked: [
    { track: '3', likedAt: '2025-06-01T10:00:00Z' },
    { track: '1', likedAt: '2024-01-01T10:00:00Z' },
    { track: '2', likedAt: '2024-03-01T10:00:00Z' },
    { track: '4' },
    { track: '5' },
  ],
  playlists: [
    { id: '1003', title: 'Дорога', tracks: ['1', '3', '4', '5'] },
    { id: '1004', title: 'Спорт', tracks: ['2', '1'] },
  ],
  albums: [],
};

const matched = (candidate: Candidate) => ({ status: 'matched' as const, match: { candidate, score: { value: 1, reasons: [] } }, why: 'a sure match' });
const MATCHES: Matches = {
  format: 'crossfade-matches',
  version: 1,
  library: { source: 'yandex-music', exportedAt: '2026-11-03T17:00:00Z' },
  tracks: {
    '1': matched(song('k1', 'Группа крови', ['Кино'], 285_000)),
    '2': matched(song('q1', 'Bohemian Rhapsody', ['Queen'], 355_000)),
    '3': matched(song('y1', 'Provans', ['Yolka'], 205_000)),
    '4': { status: 'review', candidates: [], why: 'not sure enough' },
    '5': { status: 'missing', candidates: [], why: 'no results' },
  },
};

const EMPTY: YouTubeLibraryContents = { liked: [], playlists: [], albums: [] };

describe('planning an import', () => {
  test('likes the matched songs, oldest first', () => {
    const plan = planImport(LIBRARY, MATCHES, EMPTY);
    assert.deepEqual(plan.likes, [
      { track: '1', videoId: 'k1' },
      { track: '2', videoId: 'q1' },
      { track: '3', videoId: 'y1' },
    ]);
    assert.equal(plan.alreadyLiked, 0);
  });

  test('likes without a date keep the order Yandex gave, reversed', () => {
    const undated = { ...LIBRARY, liked: [{ track: '3' }, { track: '1' }, { track: '2' }] };
    assert.deepEqual(planImport(undated, MATCHES, EMPTY).likes.map(like => like.track), ['2', '1', '3']);
  });

  test('a song liked already is not liked again, under its own id or another', () => {
    const existing = {
      ...EMPTY,
      // The very video, and the same recording from another release.
      liked: [song('k1', 'Группа крови', ['Кино'], 285_000), song('q-album', 'Bohemian Rhapsody (Remastered 2011)', ['Queen'], 356_000)],
    };
    const plan = planImport(LIBRARY, MATCHES, existing);
    assert.deepEqual(plan.likes, [{ track: '3', videoId: 'y1' }]);
    assert.equal(plan.alreadyLiked, 2);
  });

  test('a live version liked already is not the same song', () => {
    const existing = { ...EMPTY, liked: [song('q-live', 'Bohemian Rhapsody (Live Aid)', ['Queen'], 356_000)] };
    assert.equal(planImport(LIBRARY, MATCHES, existing).alreadyLiked, 0);
  });

  test('playlists are created with their matched songs, in order', () => {
    const plan = planImport(LIBRARY, MATCHES, EMPTY);
    assert.deepEqual(plan.playlists, [
      { source: '1003', title: 'Дорога', add: ['k1', 'y1'], unmatched: 2, present: 0 },
      { source: '1004', title: 'Спорт', add: ['q1', 'k1'], unmatched: 0, present: 0 },
    ]);
  });

  test('a playlist of the same name is added to, without what it has', () => {
    const existing = { ...EMPTY, playlists: [{ id: 'PLsport', title: 'спорт', items: [song('q1', 'Bohemian Rhapsody', ['Queen'], 355_000)] }] };
    const [, sport] = planImport(LIBRARY, MATCHES, existing).playlists;
    assert.deepEqual(sport, { source: '1004', title: 'Спорт', existing: 'PLsport', add: ['k1'], unmatched: 0, present: 1 });
  });

  test('what is left out, and why', () => {
    const plan = planImport(LIBRARY, MATCHES, EMPTY);
    assert.equal(plan.toReview, 1);
    assert.equal(plan.notFound, 1);
  });

  test('the plan in words', () => {
    const existing = { ...EMPTY, liked: [song('k1', 'Группа крови', ['Кино'], 285_000)], playlists: [{ id: 'PLsport', title: 'Спорт', items: [] }] };
    assert.deepEqual(describePlan(planImport(LIBRARY, MATCHES, existing)), [
      'Would like 2 songs (1 liked already).',
      'Would create the playlist "Дорога" with 2 songs (2 without a match).',
      'Would add 2 songs to your playlist "Спорт".',
      'Left out: 1 track to review (crossfade review), 1 not on YouTube Music.',
    ]);
  });
});

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const libraryFile = join(base, 'library.json');
  const matchesFile = join(base, 'matches.json');
  await writeFile(libraryFile, JSON.stringify(LIBRARY));
  await writeFile(matchesFile, JSON.stringify(MATCHES));
  const store = new CredentialStore(join(base, 'config'));
  const out: string[] = [];
  const err: string[] = [];
  const run = (dryRun: boolean, parts: ImportParts = {}) =>
    importMatches(
      libraryFile,
      matchesFile,
      dryRun,
      { out: s => out.push(s), err: s => err.push(s) },
      { store, clock: { now: () => 0, sleep: async () => {} }, fetch },
      {
        readExisting: async (_, progress) => {
          progress('0 liked songs');
          return EMPTY;
        },
        ...parts,
      },
    );
  return { store, out, err, run };
}

describe('crossfade import --dry-run', () => {
  test('prints the plan and changes nothing', async t => {
    const { store, out, err, run } = await setup(t);
    await store.save('youtube-music', { cookie: 'SID=s; __Secure-3PAPISID=x', authUser: '0' });
    assert.equal(await run(true), 0);
    assert.equal(out[0], 'Would like 3 songs (0 liked already).');
    assert.equal(out.at(-1), 'Nothing was changed: this was a dry run.');
    assert.deepEqual(err, ['Reading what is in your YouTube Music library...', '  0 liked songs']);
  });

  test('without a YouTube Music sign-in it says how to sign in', async t => {
    const { err, run } = await setup(t);
    assert.equal(await run(true), 1);
    assert.deepEqual(err, ['crossfade is not signed in to YouTube Music. Run: crossfade login youtube-music']);
  });
});

/** A YouTube Music that writes down what it was asked to do. */
function recorder(failAt = Infinity) {
  const done: string[] = [];
  const writer: Writer = {
    like: async videoId => {
      if (done.length >= failAt) throw new Error('POST https://music.youtube.com/youtubei/v1/like/like: 429 Too Many Requests');
      done.push(`like ${videoId}`);
    },
    createPlaylist: async (title, description, videoIds) => {
      done.push(`create "${title}" "${description}" ${videoIds.join(',')}`);
      return 'PLnew';
    },
    addToPlaylist: async (id, videoIds) => void done.push(`add ${id} ${videoIds.join(',')}`),
  };
  return { writer, done };
}

describe('carrying out a plan', () => {
  test('likes first, then playlists made or added to', async () => {
    const existing = { ...EMPTY, playlists: [{ id: 'PLsport', title: 'Спорт', items: [] }] };
    const withDescription = { ...LIBRARY, playlists: [{ ...LIBRARY.playlists[0]!, description: 'В машину' }, LIBRARY.playlists[1]!] };
    const { writer, done } = recorder();
    const progress: string[] = [];
    await carryOut(planImport(withDescription, MATCHES, existing), writer, message => progress.push(message));
    assert.deepEqual(done, ['like k1', 'like q1', 'like y1', 'create "Дорога" "В машину" k1,y1', 'add PLsport q1,k1']);
    assert.deepEqual(progress, ['liked 3 of 3', 'made "Дорога" with 2 songs', 'added 2 songs to "Спорт"']);
  });

  test('a playlist with nothing to add is left alone', async () => {
    const existing = { ...EMPTY, playlists: [{ id: 'PLsport', title: 'Спорт', items: [song('q1', 'Bohemian Rhapsody', ['Queen'], 355_000), song('k1', 'Группа крови', ['Кино'], 285_000)] }] };
    const { writer, done } = recorder();
    await carryOut(planImport(LIBRARY, MATCHES, existing), writer);
    assert.ok(!done.some(step => step.includes('PLsport')));
  });
});

describe('crossfade import', () => {
  async function signedIn(t: { after: (fn: () => Promise<void>) => void }) {
    const parts = await setup(t);
    await parts.store.save('youtube-music', { cookie: 'SID=s; __Secure-3PAPISID=x', authUser: '0' });
    return parts;
  }

  test('shows the plan, asks, and goes ahead only on yes', async t => {
    const { out, run } = await signedIn(t);
    const asked: string[] = [];
    const { writer, done } = recorder();
    assert.equal(await run(false, { writer, ask: async prompt => (asked.push(prompt), 'y') }), 0);
    assert.deepEqual(asked, ['Go ahead and change your YouTube Music library? (y/N) ']);
    assert.equal(done.length, 5);
    assert.equal(out.at(-1), 'Done. Run "crossfade import --dry-run" to check that nothing is left.');
  });

  test('anything but yes changes nothing', async t => {
    for (const answer of ['', 'n', 'no', 'yy', undefined]) {
      const { out, run } = await signedIn(t);
      const { writer, done } = recorder();
      assert.equal(await run(false, { writer, ask: async () => answer }), 0);
      assert.deepEqual(done, []);
      assert.equal(out.at(-1), 'Nothing was changed.');
    }
  });

  test('a run that stops says how to go on', async t => {
    const { err, run } = await signedIn(t);
    const { writer, done } = recorder(1);
    assert.equal(await run(false, { writer, ask: async () => 'yes' }), 1);
    assert.deepEqual(done, ['like k1']);
    assert.match(err.at(-1) ?? '', /^Stopped\. Run "crossfade import" again to go on: what is done already will be skipped\.$/m);
  });

  test('nothing to do when YouTube Music has it all', async t => {
    const { out, run } = await signedIn(t);
    const everything = { liked: [song('k1', 'Группа крови', ['Кино'], 285_000), song('q1', 'Bohemian Rhapsody', ['Queen'], 355_000), song('y1', 'Provans', ['Yolka'], 205_000)], playlists: [{ id: 'PLroad', title: 'Дорога', items: [song('k1', 'Группа крови', ['Кино'], 285_000), song('y1', 'Provans', ['Yolka'], 205_000)] }, { id: 'PLsport', title: 'Спорт', items: [song('q1', 'Bohemian Rhapsody', ['Queen'], 355_000), song('k1', 'Группа крови', ['Кино'], 285_000)] }], albums: [] };
    const asked: string[] = [];
    assert.equal(await run(false, { readExisting: async () => everything, ask: async prompt => (asked.push(prompt), 'y') }), 0);
    assert.deepEqual(asked, []);
    assert.equal(out.at(-1), 'Nothing to add: YouTube Music has it all.');
  });
});
