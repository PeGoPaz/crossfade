import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { type Library, LibraryError, parseLibrary } from '../src/library.ts';

function library(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'crossfade-library',
    version: 1,
    source: 'yandex-music',
    exportedAt: '2026-11-03T08:30:00Z',
    tracks: [
      {
        id: '1',
        title: 'Группа крови',
        artists: ['Кино'],
        album: 'Группа крови',
        year: 1988,
        durationMs: 286000,
      },
      {
        id: '2',
        title: 'Bohemian Rhapsody',
        version: 'Remastered 2011',
        artists: ['Queen'],
        durationMs: 354000,
        isrc: 'GBUM71029604',
      },
    ],
    liked: [{ track: '2', likedAt: '2024-05-01T10:00:00+03:00' }, { track: '1' }],
    playlists: [{ id: '1003', title: 'Дорога', description: '', tracks: ['1', '2', '1'] }],
    albums: [{ id: '55', title: 'Группа крови', artists: ['Кино'], year: 1988, trackCount: 11 }],
    ...changes,
  };
}

/** The problems parseLibrary finds in a file, or [] if it accepts it. */
function problems(file: unknown): string[] {
  try {
    parseLibrary(JSON.stringify(file));
    return [];
  } catch (error) {
    assert.ok(error instanceof LibraryError);
    return error.problems;
  }
}

describe('parseLibrary', () => {
  test('returns a valid file as it is', () => {
    const file = library();
    const parsed: Library = parseLibrary(JSON.stringify(file));
    assert.deepEqual(parsed, file);
  });

  test('accepts an empty library', () => {
    assert.deepEqual(problems(library({ tracks: [], liked: [], playlists: [], albums: [] })), []);
  });

  test('ignores fields the format does not define', () => {
    assert.deepEqual(problems(library({ note: 'exported for the move' })), []);
  });

  test('says when the text is not JSON', () => {
    assert.throws(() => parseLibrary('{"format": '), (error: LibraryError) => {
      assert.match(error.problems[0] ?? '', /^not JSON: /);
      return true;
    });
  });

  test('says when the file is something else', () => {
    assert.deepEqual(problems({ name: 'package' }), [
      'not a crossfade library file: "format" should be "crossfade-library"',
    ]);
    assert.deepEqual(problems([]), ['not a crossfade library file: "format" should be "crossfade-library"']);
  });

  test('says when a newer crossfade wrote the file', () => {
    assert.deepEqual(problems(library({ version: 2 })), [
      'written by a newer crossfade (format version 2); update crossfade to read it',
    ]);
  });

  test('names the place of each wrong field', () => {
    const file = library();
    const [first, second] = file.tracks as Record<string, unknown>[];
    Object.assign(first!, { title: ' ', durationMs: -5, year: 1988.5 });
    Object.assign(second!, { artists: 'Queen', isrc: 'gb-um7-10-29604' });
    file.exportedAt = 'yesterday';
    file.liked = [{ track: '2', likedAt: '2024-05-01' }];

    assert.deepEqual(problems(file), [
      'exportedAt: should be a date and time like 2026-11-03T08:30:00Z',
      'tracks[0].title: should be a non-empty string',
      'tracks[0].year: should be a whole number above 0',
      'tracks[0].durationMs: should be a whole number above 0',
      'tracks[1].artists: should be a list of non-empty strings',
      'tracks[1].isrc: should be 12 letters and digits like GBAYE6900531',
      'liked[0].likedAt: should be a date and time like 2026-11-03T08:30:00Z',
    ]);
  });

  test('a time without a time zone is not accepted', () => {
    // It would mean a different moment on every computer that reads it.
    assert.deepEqual(problems(library({ exportedAt: '2026-11-03T08:30:00' })), [
      'exportedAt: should be a date and time like 2026-11-03T08:30:00Z',
    ]);
  });

  test('a list that is missing or not a list', () => {
    const file = library({ albums: { id: '55' } });
    delete file.liked;
    assert.deepEqual(problems(file), ['liked: should be a list', 'albums: should be a list']);
    assert.deepEqual(problems(library({ playlists: ['Дорога'] })), ['playlists[0]: should be an object']);
  });

  test('likes and playlists must point to tracks in the file', () => {
    const file = library({
      liked: [{ track: '2' }, { track: '7' }],
      playlists: [{ id: '1003', title: 'Дорога', tracks: ['1', '8'] }],
    });
    assert.deepEqual(problems(file), [
      'liked[1].track: no track with id "7" in tracks',
      'playlists[0].tracks[1]: no track with id "8" in tracks',
    ]);
  });

  test('a track with a wrong field still counts as being in the file', () => {
    const file = library();
    (file.tracks as Record<string, unknown>[])[0]!.title = '';
    assert.deepEqual(problems(file), ['tracks[0].title: should be a non-empty string']);
  });

  test('ids are unique, and a track is liked once', () => {
    const file = library({
      liked: [{ track: '1' }, { track: '1' }],
      playlists: [],
      albums: [
        { id: '55', title: 'A', artists: [] },
        { id: '55', title: 'B', artists: [] },
      ],
    });
    (file.tracks as Record<string, unknown>[])[1]!.id = '1';
    assert.deepEqual(problems(file), [
      'tracks[1].id: "1" is already in tracks[0]',
      'liked[1].track: "1" is already in liked[0]',
      'albums[1].id: "55" is already in albums[0]',
    ]);
  });

  test('lists the first 20 problems of a badly broken file', () => {
    const tracks = Array.from({ length: 25 }, (_, i) => ({ id: String(i), title: '', artists: [] }));
    const found = problems(library({ tracks, liked: [], playlists: [] }));
    assert.equal(found.length, 21);
    assert.equal(found[20], '... and 5 more');
  });

  test('the example in docs/library-format.md is valid', () => {
    const docs = readFileSync(new URL('../docs/library-format.md', import.meta.url), 'utf8');
    const example = /```json\n(.*?)```/s.exec(docs)?.[1];
    assert.ok(example, 'the docs have a JSON example');
    assert.equal(parseLibrary(example).tracks.length, 2);
  });
});
