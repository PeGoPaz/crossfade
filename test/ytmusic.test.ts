import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { Requests } from '../src/requests.ts';
import { YouTubeMusic, context, parseSearch } from '../src/ytmusic/search.ts';

/**
 * Answers YouTube Music gave on 3 November 2026 to public searches, cut down
 * to the result rows: titles, linked artists and albums, durations, ids.
 */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`fixtures/ytmusic/${name}.json`, import.meta.url), 'utf8'));
}

describe('YouTube Music search', () => {
  test('song rows: title, artists, album, duration', () => {
    const results = parseSearch(fixture('search-songs-kino'), 'song');
    assert.equal(results.length, 6);
    assert.deepEqual(results[0], {
      id: 'xtxjm7ciwmc',
      title: 'Группа крови',
      artists: ['Кино'],
      album: 'Группа крови',
      durationMs: 285_000,
      kind: 'song',
    });
    assert.deepEqual(results[2]?.artists, ['Виктор Цой & Группа Кино']);
  });

  test('several linked artists', () => {
    const [, cover] = parseSearch(fixture('search-songs-queen'), 'song');
    assert.deepEqual(cover?.artists, ['Alex Goot', 'Sam Tsui', 'Tyler Ward', 'Kurt Hugo Schneider']);
    assert.equal(cover?.album, 'Bohemian Rhapsody');
  });

  test('video rows: the channel stands in for the artist, and there is no album', () => {
    const [first, , , fourth] = parseSearch(fixture('search-videos-kino'), 'video');
    assert.deepEqual(first, {
      id: 'WhhGiIoQjk8',
      title: '5 песен Виктора Цоя',
      artists: ['Vicktor Tsoi - фан'],
      durationMs: 24 * 60_000 + 9_000,
      kind: 'video',
    });
    assert.deepEqual(fourth?.artists, ['Кино']);
  });

  test('an artist without a link is read from the text', () => {
    const row = {
      musicResponsiveListItemRenderer: {
        playlistItemData: { videoId: 'abc' },
        flexColumns: [
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song' }] } } },
          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Someone' }, { text: ' • ' }, { text: '1:02:03' }] } } },
        ],
      },
    };
    const answer = { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [row] } }] } } } }] } } };
    assert.deepEqual(parseSearch(answer, 'song'), [
      { id: 'abc', title: 'Song', artists: ['Someone'], durationMs: 3_723_000, kind: 'song' },
    ]);
  });

  test('no results, and rows that cannot be liked', () => {
    const empty = { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [] } } } }] } } };
    assert.deepEqual(parseSearch(empty, 'song'), []);
    const title = { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'A podcast, say' }] } } };
    const noId = { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [{ musicResponsiveListItemRenderer: { flexColumns: [title] } }] } }] } } } }] } } };
    assert.deepEqual(parseSearch(noId, 'song'), []);
  });

  test('an answer in another shape means YouTube Music has changed', () => {
    assert.throws(() => parseSearch({ contents: { singleColumnBrowseResultsRenderer: {} } }, 'song'), /crossfade may need an update/);
  });

  test('asks as the web client, with the filter of the tab', async () => {
    let request: { url: string; body: Record<string, unknown> } | undefined;
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), body: JSON.parse(String(init?.body)) };
      return Response.json(fixture('search-songs-queen'));
    };
    const ytmusic = new YouTubeMusic(new Requests({ spacingMs: 0, fetch }), () => Date.parse('2026-11-03T14:20:00Z'));
    const results = await ytmusic.search('Queen Bohemian Rhapsody');
    assert.equal(results[0]?.id, 'BSTsnWoslP4');
    assert.equal(request?.url, 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false');
    assert.deepEqual(request?.body, {
      context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20261103.01.00', hl: 'en' } },
      query: 'Queen Bohemian Rhapsody',
      params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
    });
  });

  test('the client version follows the date', () => {
    assert.equal(context(Date.parse('2027-01-09T23:59:00Z')).client.clientVersion, '1.20270109.01.00');
  });
});
