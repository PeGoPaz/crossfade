import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { albumQuery, decideAlbum, findAlbum, scoreAlbum } from '../src/albums.ts';
import type { Album } from '../src/library.ts';
import type { AlbumCandidate } from '../src/score.ts';

const kino: Album = { id: '55', title: 'Группа крови', artists: ['Кино'], year: 1988 };

const album = (title: string, artists: string[], year?: number): AlbumCandidate => ({
  browseId: `MPREb_${title}`,
  playlistId: `OLAK5uy_${title}`,
  title,
  artists,
  ...(year !== undefined ? { year } : {}),
});

describe('matching an album', () => {
  test('the search is the main artist and the title', () => {
    assert.equal(albumQuery(kino), 'Кино Группа крови');
    assert.equal(albumQuery({ ...kino, artists: [] }), 'Группа крови');
  });

  test('a sure match: the same title, artists and year', () => {
    const score = scoreAlbum(kino, album('Группа крови', ['Кино'], 1988));
    assert.equal(score.value, 1);
    assert.deepEqual(score.reasons, ['title 100%', 'artists 100%', 'same year']);
    assert.equal(decideAlbum(kino, [album('Группа крови', ['Кино'], 1988)]).status, 'matched');
  });

  test('a different year lowers the score rather than ruling the album out', () => {
    const decision = decideAlbum(kino, [album('Группа крови', ['Кино'], 2021)]);
    if (decision.status !== 'matched') return assert.fail('expected a match');
    assert.equal(decision.match.score.value, 0.9);
    assert.ok(decision.match.score.reasons.includes('year differs (1988 vs 2021)'));
  });

  test('a different artist is not the album', () => {
    assert.equal(decideAlbum(kino, [album('Группа крови', ['Кто-то'], 1988)]).status, 'missing');
  });

  test('two close results are left out, with the closest kept for the report', () => {
    const decision = decideAlbum(kino, [
      album('Группа крови', ['Кино'], 2021),
      album('Группа крови', ['Кино'], 2005),
    ]);
    if (decision.status !== 'missing') return assert.fail('expected missing');
    assert.equal(decision.why, 'two results come close');
    assert.equal(decision.candidates.length, 2);
  });

  test('no results', () => {
    assert.deepEqual(decideAlbum(kino, []), {
      status: 'missing',
      candidates: [],
      why: 'no results',
    });
  });

  test('findAlbum searches and decides', async () => {
    const asked: string[] = [];
    const decision = await findAlbum(kino, async (query) => {
      asked.push(query);
      return [album('Группа крови', ['Кино'], 1988)];
    });
    assert.deepEqual(asked, ['Кино Группа крови']);
    assert.equal(decision.status, 'matched');
  });
});
