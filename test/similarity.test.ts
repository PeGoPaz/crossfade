import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { artistSimilarity, editDistance, similarity } from '../src/similarity.ts';
import { key } from '../src/text.ts';

describe('editDistance', () => {
  test('counts added, removed and changed letters', () => {
    assert.equal(editDistance('kitten', 'sitting'), 3);
    assert.equal(editDistance('', 'abc'), 3);
    assert.equal(editDistance('abc', 'abc'), 0);
  });

  test('counts a letter outside the basic plane as one', () => {
    assert.equal(editDistance('a🎵', 'ab'), 1);
  });
});

describe('similarity', () => {
  test('is 1 for the same text and the same either way round', () => {
    assert.equal(similarity('hey jude', 'hey jude'), 1);
    assert.equal(similarity('', ''), 1);
    assert.equal(similarity('gruppa krovi', 'gruppa krov'), similarity('gruppa krov', 'gruppa krovi'));
  });

  test('forgives the ways Cyrillic is spelled in Latin letters', () => {
    const pairs = [
      ['Цой', 'Tsoy'],
      ['Ёлка', 'Yolka'],
      ['Мумий Тролль', 'Mumiy Troll'],
      ['Океан Ельзи', 'Okean Elzy'],
      ['Би-2', 'Bi-2'],
      ['Михаил Круг', 'Mihail Krug'],
      ['Филипп Киркоров', 'Philip Kirkorov'],
    ];
    for (const [cyrillic, latin] of pairs) {
      assert.equal(similarity(key(cyrillic!), key(latin!)), 1, `${cyrillic} and ${latin}`);
    }
  });

  test('forgives a typo in a long title', () => {
    assert.ok(similarity('bohemian rhapsody', 'bohemian rapsody') > 0.9);
  });

  test('keeps different titles apart', () => {
    assert.ok(similarity('song', 'song part 2') < 0.6);
    assert.ok(similarity('yesterday', 'tomorrow') < 0.5);
    assert.ok(similarity(key('Кукушка'), key('Звезда')) < 0.3);
  });
});

describe('artistSimilarity', () => {
  test('one service names only the main artist', () => {
    assert.equal(artistSimilarity(['queen', 'david bowie'], ['queen']), 1);
    assert.equal(artistSimilarity(['queen'], ['queen', 'david bowie']), 1);
  });

  test('one name on one side, two on the other', () => {
    assert.equal(artistSimilarity([key('Simon & Garfunkel')], [key('Simon'), key('Garfunkel')]), 1);
  });

  test('spelling of Cyrillic names', () => {
    assert.equal(artistSimilarity([key('Кино')], [key('Kino')]), 1);
    assert.equal(artistSimilarity([key('Виктор Цой'), key('Кино')], [key('Kino'), key('Viktor Tsoi')]), 1);
  });

  test('different artists', () => {
    assert.ok(artistSimilarity([key('Кино')], [key('Аквариум')]) < 0.5);
    assert.ok(artistSimilarity(['kino'], ['kino tribute band']) < 0.5);
  });

  test('no artists on one side is no evidence', () => {
    assert.equal(artistSimilarity([], ['queen']), 0);
    assert.equal(artistSimilarity(['queen'], []), 0);
  });
});
