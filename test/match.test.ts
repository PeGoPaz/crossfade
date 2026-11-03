import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { CredentialStore } from '../src/credentials.ts';
import { type Search, findTrack, matchLibrary, query } from '../src/match.ts';
import { parseMatches } from '../src/matches.ts';
import { HttpError } from '../src/requests.ts';
import type { Candidate } from '../src/score.ts';

const kino = { id: '1', title: 'Группа крови', artists: ['Кино'], durationMs: 286_000 };
const yolka = { id: '2', title: 'Прованс', artists: ['Ёлка'], durationMs: 215_000 };
const demo = { id: '3', title: 'Демо', artists: ['Мой друг'], durationMs: 180_000 };

const LIBRARY = {
  format: 'crossfade-library',
  version: 1,
  source: 'yandex-music',
  exportedAt: '2026-11-03T13:40:00Z',
  tracks: [kino, yolka, demo],
  liked: [{ track: '1' }, { track: '2' }, { track: '3' }],
  playlists: [],
  albums: [],
};

const song = (id: string, title: string, artists: string[], durationMs: number): Candidate => ({ id, title, artists, durationMs, kind: 'song' });
const video = (id: string, title: string, artists: string[], durationMs: number): Candidate => ({ id, title, artists, durationMs, kind: 'video' });

/** YouTube Music as answers by query and tab; it remembers what it was asked. */
function youtube(answers: Record<string, Candidate[] | Error>) {
  const asked: string[] = [];
  const search: Search = async (text, kind) => {
    asked.push(`${kind}: ${text}`);
    const answer = answers[`${kind}: ${text}`] ?? [];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { search, asked };
}

const ANSWERS = {
  'song: Кино Группа крови': [song('k1', 'Группа крови', ['Кино'], 285_000)],
  'song: Ёлка Прованс': [],
  'video: Ёлка Прованс': [video('y1', 'Ёлка - Прованс (Official Video)', ['ЁлкаVEVO'], 216_000)],
  'song: Мой друг Демо': [],
  'video: Мой друг Демо': [],
};

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const libraryFile = join(base, 'library.json');
  const matchesFile = join(base, 'matches.json');
  await writeFile(libraryFile, JSON.stringify(LIBRARY));
  const out: string[] = [];
  const err: string[] = [];
  const deps = { store: new CredentialStore(join(base, 'config')), clock: { now: () => 0, sleep: async () => {} }, fetch };
  const run = (search: Search) => matchLibrary(libraryFile, matchesFile, { out: s => out.push(s), err: s => err.push(s) }, deps, search);
  return { libraryFile, matchesFile, out, err, run };
}

describe('matching a track', () => {
  test('the search is the main artist, the title and the version note', () => {
    assert.equal(query(kino), 'Кино Группа крови');
    assert.equal(query({ ...kino, artists: ['Кино', 'Виктор Цой'], version: 'Live' }), 'Кино Группа крови Live');
    assert.equal(query({ ...kino, artists: [] }), 'Группа крови');
  });

  test('a sure song match needs no video search', async () => {
    const { search, asked } = youtube(ANSWERS);
    const decision = await findTrack(kino, search);
    assert.equal(decision.status, 'matched');
    assert.deepEqual(asked, ['song: Кино Группа крови']);
  });

  test('videos are searched when songs give nothing sure', async () => {
    const { search, asked } = youtube(ANSWERS);
    const decision = await findTrack(yolka, search);
    assert.equal(decision.status, 'matched');
    assert.equal(decision.status === 'matched' && decision.match.candidate.id, 'y1');
    assert.deepEqual(asked, ['song: Ёлка Прованс', 'video: Ёлка Прованс']);
  });

  test('a result found among both songs and videos is counted once', async () => {
    const twice = song('k1', 'Группа крови', ['Кино'], 300_000); // 14 s off: not sure
    const { search } = youtube({ 'song: Кино Группа крови': [twice], 'video: Кино Группа крови': [{ ...twice, kind: 'video' }] });
    const decision = await findTrack(kino, search);
    assert.equal(decision.status, 'review');
    assert.equal(decision.status === 'review' && decision.candidates.length, 1);
  });
});

describe('crossfade match', () => {
  test('decides on every track and saves it', async t => {
    const { matchesFile, out, run } = await setup(t);
    assert.equal(await run(youtube(ANSWERS).search), 0);
    const matches = parseMatches(await readFile(matchesFile, 'utf8'));
    assert.deepEqual(matches.library, { source: 'yandex-music', exportedAt: '2026-11-03T13:40:00Z' });
    assert.deepEqual(
      Object.entries(matches.tracks).map(([id, entry]) => [id, entry.status]),
      [['1', 'matched'], ['2', 'matched'], ['3', 'missing']],
    );
    assert.deepEqual(out, [`Saved ${matchesFile}: 2 matched, 0 to review, 1 not found on YouTube Music.`]);
  });

  test('goes on where an earlier run stopped', async t => {
    const { matchesFile, err, run } = await setup(t);
    const failing = youtube({ ...ANSWERS, 'song: Ёлка Прованс': new HttpError('POST https://music.youtube.com/youtubei/v1/search: 429 Too Many Requests, and asked to wait 60 min; try again later', 429) });
    assert.equal(await run(failing.search), 1);
    assert.match(err.at(-1) ?? '', /Stopped after 1 track; run "crossfade match" again to go on\.$/);
    assert.deepEqual(Object.keys(parseMatches(await readFile(matchesFile, 'utf8')).tracks), ['1']);

    const again = youtube(ANSWERS);
    assert.equal(await run(again.search), 0);
    assert.ok(!again.asked.some(asked => asked.includes('Группа крови')));
    assert.match(err.join('\n'), /1 track matched before; matching the other 2\./);
    assert.deepEqual(Object.keys(parseMatches(await readFile(matchesFile, 'utf8')).tracks), ['1', '2', '3']);
  });

  test('a library file that is not there or not valid', async t => {
    const { libraryFile, err, run } = await setup(t);
    await writeFile(libraryFile, '{"format": "crossfade-library", "version": 1}');
    assert.equal(await run(youtube(ANSWERS).search), 1);
    assert.match(err[0] ?? '', /^The library file is not valid:/);
    await rm(libraryFile);
    assert.equal(await run(youtube(ANSWERS).search), 1);
    assert.match(err[1] ?? '', /ENOENT/);
  });

  test('a matches file that is something else is not overwritten', async t => {
    const { matchesFile, err, run } = await setup(t);
    await writeFile(matchesFile, '{"name": "my notes"}');
    assert.equal(await run(youtube(ANSWERS).search), 1);
    assert.equal(err[0], 'Not a crossfade matches file: "format" should be "crossfade-matches"');
    assert.equal(await readFile(matchesFile, 'utf8'), '{"name": "my notes"}');
  });

  test('matches made for a library from another service are not mixed in', async t => {
    const { matchesFile, err, run } = await setup(t);
    const other = { format: 'crossfade-matches', version: 1, library: { source: 'spotify', exportedAt: '2026-01-01T00:00:00Z' }, tracks: {} };
    await writeFile(matchesFile, JSON.stringify(other));
    assert.equal(await run(youtube(ANSWERS).search), 1);
    assert.equal(err[0], `${matchesFile} holds matches for a library from spotify, not yandex-music`);
  });
});
