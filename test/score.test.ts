import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Track } from '../src/library.ts';
import { type Candidate, score } from '../src/score.ts';

const queen: Track = {
  id: '1',
  title: 'Bohemian Rhapsody',
  version: 'Remastered 2011',
  artists: ['Queen'],
  album: 'A Night At The Opera',
  durationMs: 354_000,
};

const kino: Track = { id: '2', title: 'Группа крови', artists: ['Кино'], durationMs: 286_000 };

function found(changes: Partial<Candidate> = {}): Candidate {
  return { id: 'fJ9rUzIMcZQ', title: 'Bohemian Rhapsody', artists: ['Queen'], durationMs: 355_000, ...changes };
}

const value = (track: Track, candidate: Candidate) => score(track, candidate).value;

describe('score', () => {
  test('the same track', () => {
    assert.deepEqual(score(queen, found({ title: 'Bohemian Rhapsody (Remastered 2011)', album: 'A Night at the Opera' })), {
      value: 1,
      reasons: ['title 100%', 'artists 100%', 'same duration', 'same album'],
    });
  });

  test('a remaster note on one side only does not count against it', () => {
    assert.equal(value(queen, found()), 1);
    assert.equal(value({ ...queen, version: undefined }, found({ title: 'Bohemian Rhapsody (2011 Remaster)' })), 1);
  });

  test('the same track spelled in Latin letters', () => {
    assert.ok(value(kino, found({ title: 'Gruppa krovi', artists: ['Kino'], durationMs: 285_000 })) >= 0.95);
  });

  test('a video titled "Artist - Title" on the artist\'s channel', () => {
    const video = found({ title: 'Queen - Bohemian Rhapsody (Official Video Remastered)', artists: ['Queen Official'] });
    assert.ok(value(queen, video) >= 0.95);
    assert.ok(value(queen, found({ artists: ['QueenVEVO'] })) >= 0.95);
  });

  test('featured artists named in the title on one side and listed on the other', () => {
    const despacito: Track = { id: '3', title: 'Despacito', artists: ['Luis Fonsi', 'Daddy Yankee'], durationMs: 229_000 };
    assert.ok(value(despacito, found({ title: 'Despacito (feat. Daddy Yankee)', artists: ['Luis Fonsi'], durationMs: 229_000 })) >= 0.95);
  });

  test('a live recording or a remix is a different recording', () => {
    const live = score(queen, found({ title: 'Bohemian Rhapsody (Live Aid 1985)', durationMs: 356_000 }));
    assert.ok(live.value <= 0.5);
    assert.ok(live.reasons.includes('"live" only on YouTube Music'));
    assert.ok(value({ ...queen, version: 'Live' }, found()) <= 0.5);
    assert.ok(value(queen, found({ title: 'Bohemian Rhapsody (Remix)' })) <= 0.5);
  });

  test('the same live recording matches', () => {
    assert.ok(value({ ...queen, version: 'Live' }, found({ title: 'Bohemian Rhapsody (Live)' })) >= 0.95);
  });

  test('a cover by someone else', () => {
    assert.equal(value(kino, found({ title: 'Группа крови', artists: ['Би-2'], durationMs: 301_000 })), 0);
  });

  test('other artists with the same title and length go to a person to decide', () => {
    const credited = score(kino, found({ title: 'Gruppa krovi', artists: ['Viktor Tsoi'], durationMs: 287_000 }));
    assert.equal(credited.value, 0.5);
    assert.ok(credited.reasons.includes('other artists, but the same title and length'));
  });

  test('a different song by the same artist', () => {
    assert.ok(value(queen, found({ title: 'Killer Queen', durationMs: 181_000 })) < 0.5);
  });

  test('the further the duration, the lower the score', () => {
    const at = (durationMs: number) => value(queen, found({ durationMs }));
    assert.equal(at(357_000), 1);
    assert.ok(at(362_000) < at(357_000));
    assert.ok(at(380_000) < at(362_000));
    assert.ok(at(420_000) < at(380_000));
    assert.ok(at(420_000) <= 0.4);
  });

  test('an edit is doubted a little, and the duration judges the rest', () => {
    const edit = score(queen, found({ title: 'Bohemian Rhapsody (Radio Edit)', durationMs: 300_000 }));
    assert.deepEqual(edit.reasons, ['title 100%', 'artists 100%', '"edit" only on YouTube Music', 'duration differs by 54 s']);
    assert.equal(edit.value, 0.36);
  });

  test('an unknown duration leaves a little doubt, which the same album takes away', () => {
    assert.equal(value(queen, found({ durationMs: undefined })), 0.95);
    assert.equal(value(queen, found({ durationMs: undefined, album: 'A Night At The Opera' })), 1);
  });

  test('without artists a title alone is never sure', () => {
    const result = score({ ...queen, artists: [] }, found());
    assert.equal(result.value, 0.7);
    assert.ok(result.reasons.includes('no artists to compare'));
  });

  test('the same ISRC settles it', () => {
    const track = { ...queen, isrc: 'GBUM71029604' };
    assert.deepEqual(score(track, found({ title: 'Bohemian Rhapsody - Remastered', isrc: 'GBUM71029604' })), {
      value: 1,
      reasons: ['same ISRC'],
    });
  });
});
