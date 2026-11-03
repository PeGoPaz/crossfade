import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { key, parseTitle } from '../src/text.ts';

describe('key', () => {
  test('drops case and accents', () => {
    assert.equal(key('Beyoncé'), 'beyonce');
    assert.equal(key('Motörhead'), 'motorhead');
    assert.equal(key('Sigur Rós'), 'sigur ros');
    assert.equal(key('Straße'), 'strasse');
  });

  test('spells Cyrillic in Latin letters', () => {
    assert.equal(key('Кино'), 'kino');
    assert.equal(key('Группа крови'), 'gruppa krovi');
    assert.equal(key('Цой'), 'tsoi');
    assert.equal(key('Щедрик'), 'shchedrik');
    assert.equal(key('Ёлка'), key('Елка'));
    assert.equal(key('Їжак'), 'izhak');
  });

  test('drops punctuation, and apostrophes without splitting the word', () => {
    assert.equal(key("Don't Stop Me Now"), 'dont stop me now');
    assert.equal(key('AC/DC'), 'ac dc');
    assert.equal(key('  Hey   Jude!  '), 'hey jude');
  });

  test('reads every way of joining names alike', () => {
    for (const title of ['Rock & Roll', 'Rock and Roll', "Rock 'n' Roll"]) {
      assert.equal(key(title), 'rock roll');
    }
    assert.equal(key('Мастер и Маргарита'), 'master margarita');
  });

  test('turns full-width letters and ligatures into plain ones', () => {
    assert.equal(key('ＡＢＣ'), 'abc');
    assert.equal(key('ﬁre'), 'fire');
  });
});

describe('parseTitle', () => {
  test('a title without notes', () => {
    assert.deepEqual(parseTitle('Hey Jude'), { name: 'hey jude', versions: [], featuring: [] });
  });

  test('a remaster note in brackets or after a dash', () => {
    for (const title of ['Hey Jude (Remastered 2015)', 'Hey Jude - Remastered 2015', 'Hey Jude [2015 Remaster]']) {
      assert.deepEqual(parseTitle(title), { name: 'hey jude', versions: ['remaster'], featuring: [] });
    }
  });

  test('recordings that are not the studio one', () => {
    const versions = (title: string) => parseTitle(title).versions;
    assert.deepEqual(versions('Smells Like Teen Spirit (Live at Reading 1992)'), ['live']);
    assert.deepEqual(versions('Song (Tiësto Remix)'), ['remix']);
    assert.deepEqual(versions('Song (Acoustic Version)'), ['acoustic']);
    assert.deepEqual(versions('Song (Instrumental)'), ['instrumental']);
    assert.deepEqual(versions('Song (Slowed + Reverb)'), ['slowed']);
    assert.deepEqual(versions('Song (Sped Up)'), ['sped up']);
    assert.deepEqual(versions('Song - Radio Edit'), ['edit']);
    assert.deepEqual(versions('Song (Extended Mix)'), ['extended']);
    assert.deepEqual(versions('Song (Live) [Remastered]'), ['live', 'remaster']);
  });

  test('version notes in Russian', () => {
    assert.deepEqual(parseTitle('Кукушка (акустика)').versions, ['acoustic']);
    assert.deepEqual(parseTitle('Кукушка (ремикс)').versions, ['remix']);
    assert.deepEqual(parseTitle('Кукушка (концертная запись)').versions, ['live']);
    assert.deepEqual(parseTitle('Кукушка (минус)').versions, ['instrumental']);
  });

  test('the version Yandex Music keeps apart from the title', () => {
    assert.deepEqual(parseTitle('Звезда по имени Солнце', 'Live'), {
      name: 'zvezda po imeni solntse',
      versions: ['live'],
      featuring: [],
    });
  });

  test('notes that say nothing about the recording are dropped', () => {
    assert.deepEqual(parseTitle('Numb (Official Music Video) [4K UPGRADE]'), { name: 'numb', versions: [], featuring: [] });
    assert.equal(parseTitle('Song (Original Mix)').name, 'song');
    assert.equal(parseTitle('Song (From "Shrek")').name, 'song');
    assert.equal(parseTitle('Песня (из к/ф «Брат 2»)').name, 'pesnya');
    assert.equal(parseTitle('Song (prod. Someone)').name, 'song');
  });

  test('featured artists, in brackets or not', () => {
    assert.deepEqual(parseTitle('Despacito (feat. Daddy Yankee)').featuring, ['daddy yankee']);
    assert.deepEqual(parseTitle('Despacito feat. Daddy Yankee & Justin Bieber'), {
      name: 'despacito',
      versions: [],
      featuring: ['daddy yankee', 'justin bieber'],
    });
    assert.deepEqual(parseTitle('Song (ft. A, B and C)').featuring, ['a', 'b', 'c']);
    assert.deepEqual(parseTitle('Peaches (with Justin Bieber)').featuring, ['justin bieber']);
    assert.deepEqual(parseTitle('Песня (при участии Баста)').featuring, ['basta']);
  });

  test('brackets that are part of the title stay in the name', () => {
    assert.equal(parseTitle("(I Can't Get No) Satisfaction").name, 'i cant get no satisfaction');
    assert.equal(parseTitle('Song (Part 2)').name, 'song part 2');
    assert.equal(parseTitle('Песня', 'Русская версия').name, 'pesnya russkaya versiya');
  });

  test('a dash before anything other than a note stays', () => {
    assert.equal(parseTitle('Queen - Bohemian Rhapsody (Official Video)').name, 'queen bohemian rhapsody');
  });

  test('a title made only of a note keeps a name', () => {
    assert.equal(parseTitle('(Official Video)').name, 'official video');
  });
});
