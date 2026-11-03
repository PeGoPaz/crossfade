import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';

import type { Scored } from '../src/decide.ts';
import { type Entry, parseMatches } from '../src/matches.ts';
import { answer, describe as show, parseAnswer, review } from '../src/review.ts';

const nirvana = { id: '4', title: 'Smells Like Teen Spirit', version: 'Live', artists: ['Nirvana'], durationMs: 318_000 };
const prowans = { id: '3', title: 'Прованс', artists: ['Ёлка'], durationMs: 205_000 };
const kino = { id: '1', title: 'Группа крови', artists: ['Кино'], durationMs: 285_000 };

function result(id: string, title: string, artists: string[], value: number, kind: 'song' | 'video' = 'song'): Scored {
  return { candidate: { id, title, artists, durationMs: 299_000, kind }, score: { value, reasons: [`title ${value * 100}%`] } };
}

const reading = result('aaa', 'Smells Like Teen Spirit (Live at Reading 1992)', ['Nirvana'], 0.7, 'video');
const paramount = result('bbb', 'Smells Like Teen Spirit (Live at the Paramount)', ['Nirvana'], 0.65);
const toReview = (candidates: Scored[]): Entry & { status: 'review' } => ({ status: 'review', candidates, why: 'not sure enough' });

const LIBRARY = {
  format: 'crossfade-library',
  version: 1,
  source: 'yandex-music',
  exportedAt: '2026-11-03T15:00:00Z',
  tracks: [kino, prowans, nirvana],
  liked: [{ track: '1' }, { track: '3' }, { track: '4' }],
  playlists: [],
  albums: [],
};
const MATCHES = {
  format: 'crossfade-matches',
  version: 1,
  library: { source: 'yandex-music', exportedAt: '2026-11-03T15:00:00Z' },
  tracks: {
    '1': { status: 'matched', match: result('k1', 'Группа крови', ['Кино'], 1), why: 'a sure match' },
    '3': toReview([result('p1', 'Provans', ['Yolka'], 0.8), result('p2', 'Provans (Remix)', ['Yolka'], 0.4)]),
    '4': toReview([reading, paramount]),
  },
};

async function setup(t: { after: (fn: () => Promise<void>) => void }, matches: object = MATCHES) {
  const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const libraryFile = join(base, 'library.json');
  const matchesFile = join(base, 'matches.json');
  await writeFile(libraryFile, JSON.stringify(LIBRARY));
  await writeFile(matchesFile, JSON.stringify(matches));
  const out: string[] = [];
  const run = async (typed: string[]) => {
    const prompts: string[] = [];
    const code = await review(libraryFile, matchesFile, { out: s => out.push(s), err: s => out.push(s) }, async prompt => {
      prompts.push(prompt);
      return typed.shift();
    });
    return { code, prompts, saved: parseMatches(await readFile(matchesFile, 'utf8')) };
  };
  return { out, run, libraryFile, matchesFile };
}

describe('review answers', () => {
  test('what can be typed', () => {
    assert.deepEqual(parseAnswer('2', 3), { pick: 1 });
    assert.deepEqual(parseAnswer(' N ', 3), { none: true });
    assert.deepEqual(parseAnswer('', 3), { skip: true });
    assert.deepEqual(parseAnswer('s', 3), { skip: true });
    assert.deepEqual(parseAnswer('q', 3), { quit: true });
    assert.equal(parseAnswer('4', 3), undefined);
    assert.equal(parseAnswer('0', 3), undefined);
    assert.equal(parseAnswer('1.5', 3), undefined);
    assert.equal(parseAnswer('yes', 3), undefined);
  });

  test('a chosen result becomes the match, marked as chosen by you', () => {
    assert.deepEqual(answer(toReview([reading, paramount]), { pick: 1 }), {
      status: 'matched',
      match: paramount,
      why: 'chosen in review',
      by: 'you',
    });
  });

  test('none of them: not on YouTube Music, with the results kept for the report', () => {
    assert.deepEqual(answer(toReview([reading]), { none: true }), {
      status: 'missing',
      candidates: [reading],
      why: 'none of the results is the track',
      by: 'you',
    });
  });

  test('a skip changes nothing', () => {
    const entry = toReview([reading]);
    assert.equal(answer(entry, { skip: true }), entry);
  });

  test('a track is shown with each result, its score and a link to listen', () => {
    assert.equal(
      show(nirvana, toReview([reading]), '[1 of 2]'),
      [
        '[1 of 2] Nirvana - Smells Like Teen Spirit (Live)  5:18  (not sure enough)',
        '  1  Nirvana - Smells Like Teen Spirit (Live at Reading 1992)  4:59  video',
        '     70%: title 70%',
        '     https://music.youtube.com/watch?v=aaa',
      ].join('\n'),
    );
  });
});

describe('crossfade review', () => {
  test('asks about each doubtful track in library order and saves the answers', async t => {
    const { out, run } = await setup(t);
    const { code, prompts, saved } = await run(['1', 'n']);
    assert.equal(code, 0);
    assert.deepEqual(prompts, ['Which one is it? (1-2, n, s, q) ', 'Which one is it? (1-2, n, s, q) ']);
    assert.match(out[1] ?? '', /^\n\[1 of 2\] Ёлка - Прованс/);
    assert.equal(saved.tracks['3']?.status, 'matched');
    assert.equal(saved.tracks['4']?.status, 'missing');
    assert.equal(saved.tracks['1']?.status, 'matched');
    assert.equal(out.at(-1), '\nChose 1 match, marked 1 as not on YouTube Music, skipped 0. Nothing left to review.');
  });

  test('asks again after an answer it does not understand', async t => {
    const { run } = await setup(t);
    const { prompts, saved } = await run(['7', 'maybe', '2', 's']);
    assert.equal(prompts.length, 4);
    assert.equal(saved.tracks['3']?.status === 'matched' && saved.tracks['3'].match.candidate.id, 'p2');
    assert.equal(saved.tracks['4']?.status, 'review');
  });

  test('stopping keeps what was decided, and the next review starts with the rest', async t => {
    const { out, run } = await setup(t);
    const first = await run(['1', 'q']);
    assert.equal(first.saved.tracks['3']?.status, 'matched');
    assert.equal(out.at(-1), '\nChose 1 match, marked 0 as not on YouTube Music, skipped 0. 1 track left to review.');
    const second = await run(['1']);
    assert.equal(second.prompts.length, 1);
    assert.match(out.find(line => line.includes('[1 of 1]')) ?? '', /Nirvana/);
  });

  test('q stops at once, without asking about the other tracks', async t => {
    const { run } = await setup(t);
    const { prompts, saved } = await run(['q', '1']);
    assert.equal(prompts.length, 1);
    assert.equal(saved.tracks['3']?.status, 'review');
    assert.equal(saved.tracks['4']?.status, 'review');
  });

  test('input that ends is taken as stopping', async t => {
    const { run } = await setup(t);
    const { code, saved } = await run([]);
    assert.equal(code, 0);
    assert.equal(saved.tracks['3']?.status, 'review');
  });

  test('nothing to review', async t => {
    const { out, run } = await setup(t, { ...MATCHES, tracks: { '1': MATCHES.tracks['1'] } });
    const { prompts } = await run([]);
    assert.deepEqual(prompts, []);
    assert.deepEqual(out, ['Nothing to review.']);
  });

  test('from a terminal, typing answers and then closing the input', async t => {
    const { libraryFile, matchesFile } = await setup(t);
    const main = new URL('../src/main.ts', import.meta.url).pathname;
    const child = promisify(execFile)(main, ['review', '--library', libraryFile, '--matches', matchesFile]);
    child.child.stdin?.end('2\nn\n');
    const { stdout } = await child;
    assert.match(stdout, /Chose 1 match, marked 1 as not on YouTube Music, skipped 0\. Nothing left to review\.\n$/);
  });
});
