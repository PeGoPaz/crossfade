import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { Library } from '../src/library.ts';
import type { Matches } from '../src/matches.ts';
import { CSV_HEADER, describeGaps, gapRows, report } from '../src/report.ts';

const LIBRARY: Library = {
  format: 'crossfade-library',
  version: 1,
  source: 'yandex-music',
  exportedAt: '2026-11-03T18:00:00Z',
  tracks: [
    { id: '1', title: 'Группа крови', artists: ['Кино'] },
    { id: '4', title: 'Smells Like Teen Spirit', version: 'Live', artists: ['Nirvana'] },
    { id: '5', title: 'Демо', artists: ['Мой друг'] },
    { id: '6', title: 'Новая', artists: ['Кто-то'] },
  ],
  liked: [{ track: '1' }, { track: '4' }, { track: '5' }],
  playlists: [{ id: '1003', title: 'Дорога', tracks: ['5', '4', '5'] }],
  albums: [{ id: '55', title: 'Группа крови', artists: ['Кино'], year: 1988 }],
};

const closest = {
  candidate: { id: 'x', title: 'Демо (Remix)', artists: ['DJ Кто-то'] },
  score: { value: 0.12, reasons: ['title 100%', 'artists 20%', '"remix" only on YouTube Music'] },
};
const MATCHES: Matches = {
  format: 'crossfade-matches',
  version: 1,
  library: { source: 'yandex-music', exportedAt: '2026-11-03T18:00:00Z' },
  tracks: {
    '1': { status: 'matched', match: { candidate: { id: 'k1', title: 'Группа крови', artists: ['Кино'] }, score: { value: 1, reasons: [] } }, why: 'a sure match' },
    '4': { status: 'review', candidates: [], why: 'not sure enough' },
    '5': { status: 'missing', candidates: [closest], why: 'no result is close enough' },
  },
};

describe('the report', () => {
  test('what is not on YouTube Music, what waits for review, what is not matched, and the albums', () => {
    assert.deepEqual(describeGaps(LIBRARY, MATCHES), [
      'Not on YouTube Music (1):',
      '  Мой друг - Демо  [liked, Дорога]',
      '    closest: DJ Кто-то - Демо (Remix), 12%: title 100%, artists 20%, "remix" only on YouTube Music',
      'To review (1), with crossfade review:',
      '  Nirvana - Smells Like Teen Spirit (Live)  [liked, Дорога]',
      'Not matched yet: 1 track. Run crossfade match.',
      'Albums not matched yet (1). Run crossfade match.',
    ]);
  });

  test('an album not on YouTube Music is listed with its closest result', () => {
    const albums = {
      '55': {
        status: 'missing' as const,
        candidates: [
          {
            candidate: { browseId: 'MPREb_demo', playlistId: 'OLAK5uy_demo', title: 'Группа крови (Deluxe)', artists: ['Кино'], year: 2021 },
            score: { value: 0.72, reasons: ['title 100%', 'artists 100%', 'year differs (1988 vs 2021)'] },
          },
        ],
        why: 'no result is close enough',
      },
    };
    assert.deepEqual(describeGaps(LIBRARY, { ...MATCHES, albums }), [
      'Not on YouTube Music (1):',
      '  Мой друг - Демо  [liked, Дорога]',
      '    closest: DJ Кто-то - Демо (Remix), 12%: title 100%, artists 20%, "remix" only on YouTube Music',
      'To review (1), with crossfade review:',
      '  Nirvana - Smells Like Teen Spirit (Live)  [liked, Дорога]',
      'Not matched yet: 1 track. Run crossfade match.',
      'Albums not on YouTube Music (1):',
      '  Кино - Группа крови (1988)',
      '    closest: Кино - Группа крови (Deluxe), 72%: title 100%, artists 100%, year differs (1988 vs 2021)',
    ]);
  });

  test('nothing left out', () => {
    const library = { ...LIBRARY, tracks: [LIBRARY.tracks[0]!], liked: [{ track: '1' }], playlists: [], albums: [] };
    assert.deepEqual(describeGaps(library, MATCHES), ['Every track of the library has a match on YouTube Music.']);
  });

  test('the same list as a table, with a search link for each row', () => {
    const library = { ...LIBRARY, tracks: LIBRARY.tracks.map(t => (t.id === '5' ? { ...t, album: 'Демо 2019', durationMs: 185_400 } : t)) };
    const search = (words: string) => `https://music.youtube.com/search?q=${encodeURIComponent(words)}`;
    assert.deepEqual(gapRows(library, MATCHES), [
      ['to review', 'Nirvana', 'Smells Like Teen Spirit', 'Live', '', '', 'liked; Дорога', '', '', search('Nirvana Smells Like Teen Spirit')],
      ['not on YouTube Music', 'Мой друг', 'Демо', '', 'Демо 2019', '3:05', 'liked; Дорога', 'DJ Кто-то - Демо (Remix)', '12%', search('Мой друг Демо')],
      ['not matched yet', 'Кто-то', 'Новая', '', '', '', '', '', '', search('Кто-то Новая')],
      ['album not matched yet', 'Кино', 'Группа крови', '', '1988', '', 'liked albums', '', '', search('Кино Группа крови')],
    ]);
    assert.equal(gapRows(library, MATCHES)[0]?.length, CSV_HEADER.length);
  });

  test('crossfade report --csv saves the table', async t => {
    const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    await writeFile(join(base, 'library.json'), JSON.stringify(LIBRARY));
    await writeFile(join(base, 'matches.json'), JSON.stringify(MATCHES));
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) };
    const csv = join(base, 'missing.csv');
    assert.equal(await report(join(base, 'library.json'), join(base, 'matches.json'), io, csv), 0);
    assert.equal(out.at(-1), `Saved ${csv}: 4 tracks and albums to find by hand.`);
    const lines = (await readFile(csv, 'utf8')).split('\r\n');
    assert.equal(lines.length, 6);
    assert.equal(lines[0], `\uFEFF${CSV_HEADER.join(',')}`);
    assert.match(lines[2] ?? '', /^not on YouTube Music,Мой друг,Демо,/);
  });

  test('crossfade report reads the two files', async t => {
    const base = await mkdtemp(join(tmpdir(), 'crossfade-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    await writeFile(join(base, 'library.json'), JSON.stringify(LIBRARY));
    await writeFile(join(base, 'matches.json'), JSON.stringify(MATCHES));
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
    assert.equal(await report(join(base, 'library.json'), join(base, 'matches.json'), io), 0);
    assert.equal(out[0], 'Not on YouTube Music (1):');
    assert.equal(await report(join(base, 'library.json'), join(base, 'nope.json'), io), 1);
    assert.match(err[0] ?? '', /ENOENT/);
  });
});
