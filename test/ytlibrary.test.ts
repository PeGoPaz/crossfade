import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { Requests } from '../src/requests.ts';
import { YouTubeLibrary, readYouTubeLibrary } from '../src/ytmusic/library.ts';

/** Two pages of a public playlist as YouTube Music gave them on 3 November 2026, cut down to a few rows. */
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/ytmusic/${name}.json`, import.meta.url), 'utf8'));
const PAGE_1 = fixture('playlist-page1');
const PAGE_2 = fixture('playlist-page2');
/** The rows of the second page as a playlist of their own, with nothing after them. */
const SHORT = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      secondaryContents: {
        sectionListRenderer: {
          contents: [
            {
              musicPlaylistShelfRenderer: {
                contents: (PAGE_2 as { onResponseReceivedActions: { appendContinuationItemsAction: { continuationItems: unknown[] } }[] })
                  .onResponseReceivedActions[0]!.appendContinuationItemsAction.continuationItems,
              },
            },
          ],
        },
      },
    },
  },
};

// The library grids, shaped after what ytmusicapi reads from them: a signed-in
// session is needed to see real ones.
const tileOf = (title: string, browseId?: string, subtitle: object[] = []) => ({
  musicTwoRowItemRenderer: {
    title: { runs: [{ text: title, ...(browseId ? { navigationEndpoint: { browseEndpoint: { browseId } } } : {}) }] },
    subtitle: { runs: subtitle },
  },
});
const grid = (items: object[], continuation?: string) => ({
  contents: {
    singleColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    gridRenderer: {
                      items,
                      ...(continuation ? { continuations: [{ nextContinuationData: { continuation } }] } : {}),
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
});
const PLAYLISTS = grid(
  [tileOf('New playlist'), tileOf('Liked Music', 'VLLM'), tileOf('Episodes for Later', 'VLSE'), tileOf('Дорога', 'VLPLroad')],
  'GRID-PAGE-2',
);
const PLAYLISTS_2 = { continuationContents: { gridContinuation: { items: [tileOf('Спорт', 'VLPLsport')] } } };
const ALBUMS = grid([
  tileOf('Группа крови', 'MPREb_kino', [
    { text: 'Album' },
    { text: ' • ' },
    { text: 'Кино', navigationEndpoint: { browseEndpoint: { browseId: 'UCkino' } } },
    { text: ' • ' },
    { text: '1988' },
  ]),
  tileOf('Без ссылки', 'MPREb_plain', [{ text: 'EP • Кто-то • 2020' }]),
]);

interface Asked {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** YouTube Music answering by what was asked for: a browse id, or a token for the next page. */
function youtube(pages: Record<string, unknown>) {
  const asked: Asked[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    asked.push({ url: String(url), body, headers: new Headers(init?.headers) });
    const key = String(body.browseId ?? body.continuation ?? new URL(String(url)).searchParams.get('ctoken'));
    return Response.json(pages[key] ?? {});
  };
  const session = { cookie: 'SID=s; __Secure-3PAPISID=abc123/XYZ', authUser: '0' };
  const library = new YouTubeLibrary(new Requests({ spacingMs: 0, fetch }), session, () => 1_700_000_000_000);
  return { library, asked };
}

describe('reading the YouTube Music library', () => {
  test('a playlist, page after page', async () => {
    const { library, asked } = youtube({ VLPLlong: PAGE_1, 'PAGE-2-TOKEN': PAGE_2 });
    const items = await library.playlist('PLlong');
    assert.deepEqual(items.map(item => item.id), ['2BdJ8piaEkA', 'xtxjm7ciwmc', 'VcGJl9iF5Gs', '-RqYE3yvz1g', 'kzEjjniLvEU']);
    assert.deepEqual(items[1], { id: 'xtxjm7ciwmc', title: 'Группа крови', artists: ['Кино'], album: 'Группа крови', durationMs: 285_000 });
    assert.deepEqual(items[4], {
      id: 'kzEjjniLvEU',
      title: 'Счастье (Ария Тодда)',
      artists: ['Король и Шут'],
      album: 'TODD. Акт 1. Праздник Крови',
      durationMs: 206_000,
    });
    assert.deepEqual(asked.map(a => a.body.browseId ?? a.body.continuation), ['VLPLlong', 'PAGE-2-TOKEN']);
  });

  test('liked songs are the playlist LM', async () => {
    const { library, asked } = youtube({ VLLM: SHORT });
    assert.equal((await library.likedSongs()).length, 2);
    assert.equal(asked[0]?.body.browseId, 'VLLM');
  });

  test('every request is made as you', async () => {
    const { library, asked } = youtube({ VLLM: SHORT });
    await library.likedSongs();
    assert.equal(asked[0]?.headers.get('cookie'), 'SID=s; __Secure-3PAPISID=abc123/XYZ');
    assert.match(asked[0]?.headers.get('authorization') ?? '', /^SAPISIDHASH 1700000000_/);
    assert.deepEqual((asked[0]?.body.context as { client: object }).client, {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20231114.01.00',
      hl: 'en',
    });
  });

  test('your playlists, without the button, liked music and saved episodes', async () => {
    const { library, asked } = youtube({ FEmusic_liked_playlists: PLAYLISTS, 'GRID-PAGE-2': PLAYLISTS_2 });
    assert.deepEqual(await library.playlists(), [
      { id: 'PLroad', title: 'Дорога' },
      { id: 'PLsport', title: 'Спорт' },
    ]);
    // The older kind of next page: the token goes into the query.
    assert.match(asked[1]?.url ?? '', /&ctoken=GRID-PAGE-2&continuation=GRID-PAGE-2&type=next$/);
  });

  test('saved albums, with their artists and year', async () => {
    const { library } = youtube({ FEmusic_liked_albums: ALBUMS });
    assert.deepEqual(await library.albums(), [
      { id: 'MPREb_kino', title: 'Группа крови', artists: ['Кино'], year: 1988 },
      { id: 'MPREb_plain', title: 'Без ссылки', artists: ['Кто-то'], year: 2020 },
    ]);
  });

  test('an empty library', async () => {
    const { library } = youtube({});
    assert.deepEqual(await library.likedSongs(), []);
    assert.deepEqual(await library.playlists(), []);
    assert.deepEqual(await library.albums(), []);
  });

  test('a list that keeps giving the same page is read once', async () => {
    const looping = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'PAGE-2-TOKEN' } } } }] } }] };
    const { library, asked } = youtube({ VLLM: PAGE_1, 'PAGE-2-TOKEN': looping });
    assert.equal((await library.likedSongs()).length, 3);
    assert.equal(asked.length, 2);
  });

  test('the whole library at once', async () => {
    const { library } = youtube({
      VLLM: SHORT,
      FEmusic_liked_playlists: PLAYLISTS,
      'GRID-PAGE-2': PLAYLISTS_2,
      VLPLroad: SHORT,
      FEmusic_liked_albums: ALBUMS,
    });
    const progress: string[] = [];
    const contents = await readYouTubeLibrary(library, message => progress.push(message));
    assert.equal(contents.liked.length, 2);
    assert.deepEqual(contents.playlists.map(p => [p.title, p.items.length]), [['Дорога', 2], ['Спорт', 0]]);
    assert.equal(contents.albums.length, 2);
    assert.deepEqual(progress, ['2 liked songs', 'playlist 1 of 2', 'playlist 2 of 2', '2 saved albums']);
  });
});
