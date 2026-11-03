import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { decide } from '../src/decide.ts';
import type { Track } from '../src/library.ts';
import type { Candidate } from '../src/score.ts';

const track: Track = { id: '1', title: 'Прованс', artists: ['Ёлка'], durationMs: 215_000 };

let next = 0;
function result(changes: Partial<Candidate> = {}): Candidate {
  next += 1;
  return { id: `video${next}`, title: 'Provans', artists: ['Yolka'], durationMs: 215_000, kind: 'song', ...changes };
}

/** The ids of the results a decision offers or takes. */
function ids(decision: ReturnType<typeof decide>): string[] {
  return decision.status === 'matched' ? [decision.match.candidate.id] : decision.candidates.map(c => c.candidate.id);
}

describe('decide', () => {
  test('takes a sure match from among other results', () => {
    const live = result({ title: 'Provans (Live)' });
    const match = result();
    const decision = decide(track, [live, result({ title: 'Na bolshom vozdushnom share' }), match]);
    assert.equal(decision.status, 'matched');
    assert.deepEqual(ids(decision), [match.id]);
  });

  test('two sure results are one recording on two releases: the audio one is taken', () => {
    const video = result({ kind: 'video', title: 'Ёлка - Прованс (Official Video)', durationMs: 216_000 });
    const song = result({ durationMs: 214_000 });
    const decision = decide(track, [video, song]);
    assert.equal(decision.status, 'matched');
    assert.deepEqual(ids(decision), [song.id]);
  });

  test('between equal results, the one YouTube Music ranked higher', () => {
    const first = result();
    const decision = decide(track, [first, result()]);
    assert.deepEqual(ids(decision), [first.id]);
  });

  test('a good result well ahead of the rest is taken', () => {
    const good = result({ durationMs: 221_000 }); // 6 s longer
    const decision = decide(track, [good, result({ durationMs: 245_000 })]);
    assert.equal(decision.status, 'matched');
    assert.deepEqual(ids(decision), [good.id]);
    assert.equal(decision.why, 'the best result, well ahead of the rest');
  });

  test('a result just above the line is taken when nothing comes close', () => {
    const balloon: Track = { id: '2', title: 'На большом воздушном шаре', artists: ['Ёлка'], durationMs: 240_000 };
    const spelt = result({ title: 'Na bolshoi vozdushnyi share', durationMs: 240_000 });
    const decision = decide(balloon, [spelt]);
    assert.equal(decision.status, 'matched');
    assert.equal(decision.match.score.value, 0.884);
  });

  test('two good results that differ are for a person to choose from', () => {
    const longer = result({ durationMs: 221_000 });
    const shorter = result({ durationMs: 209_000 });
    const decision = decide(track, [longer, shorter]);
    assert.equal(decision.status, 'review');
    assert.equal(decision.why, 'two results come close');
    assert.deepEqual(ids(decision), [longer.id, shorter.id]);
  });

  test('a second result less good but within reach still makes it a question', () => {
    const good = result({ durationMs: 221_000 }); // 0.9: 6 s longer
    const misspelt = result({ title: 'Provanc' }); // about 0.85
    const decision = decide(track, [good, misspelt]);
    assert.equal(decision.status, 'review');
    assert.ok(decision.candidates[1]!.score.value < decision.candidates[0]!.score.value);
  });

  test('a result that is not sure enough is for a person to check', () => {
    const decision = decide(track, [result({ durationMs: 235_000 })]); // 20 s longer
    assert.equal(decision.status, 'review');
    assert.equal(decision.why, 'not sure enough');
  });

  test('a person is shown the best few, best first', () => {
    const decision = decide(track, [
      result({ durationMs: 260_000 }),
      result({ durationMs: 233_000 }),
      result({ durationMs: 236_000 }),
      result({ durationMs: 234_000 }),
    ]);
    assert.equal(decision.status, 'review');
    const values = decision.candidates.map(c => c.score.value);
    assert.equal(values.length, 3);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));
  });

  test('nothing close enough: the closest results go to the report', () => {
    const cover = result({ artists: ['Кавер-группа'], durationMs: 230_000 });
    const longer = result({ durationMs: 255_000 }); // 40 s longer: 0.4
    const decision = decide(track, [cover, result({ title: 'Другая песня' }), longer]);
    assert.equal(decision.status, 'missing');
    assert.equal(decision.why, 'no result is close enough');
    assert.deepEqual(ids(decision)[0], longer.id);
    assert.equal(decision.candidates.length, 3);
  });

  test('no results at all', () => {
    assert.deepEqual(decide(track, []), { status: 'missing', candidates: [], why: 'no results' });
  });
});
