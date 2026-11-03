/**
 * The rows YouTube Music lists tracks in - on the search page and on a
 * playlist page alike - read as candidates. The two lay a row out a little
 * differently: a search row says "Artist • Album • 4:45" in one column, a
 * playlist row has the artists, the album and the length in columns of
 * their own. Links tell the parts apart: a run of text that links to an
 * artist page is an artist, one that links to an album page is the album.
 */

import type { Candidate } from '../score.ts';

// The parts of a row that are read, every one possibly missing.
export interface Run {
  text?: string;
  navigationEndpoint?: {
    browseEndpoint?: { browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } } };
  };
}
type Column = { text?: { runs?: Run[] } };
export interface Row {
  musicResponsiveListItemRenderer?: {
    flexColumns?: { musicResponsiveListItemFlexColumnRenderer?: Column }[];
    fixedColumns?: { musicResponsiveListItemFixedColumnRenderer?: Column }[];
    playlistItemData?: { videoId?: string };
  };
}

/**
 * Pages a run of text can link to. A video's channel links to a channel
 * page; when no run links to an artist, the text before the first " • "
 * is taken instead, which is that channel's name.
 */
const ARTIST_PAGE = 'MUSIC_PAGE_TYPE_ARTIST';
const ALBUM_PAGE = 'MUSIC_PAGE_TYPE_ALBUM';
const DURATION = /^(\d+):(\d{2})(?::(\d{2}))?$/;

/** A row as a candidate, or undefined for a row that cannot be liked: no video id, or no title. */
export function parseRow(row: Row, kind?: 'song' | 'video'): Candidate | undefined {
  const item = row.musicResponsiveListItemRenderer;
  const id = item?.playlistItemData?.videoId;
  const [titleColumn = [], details = [], ...more] = (item?.flexColumns ?? []).map(
    column => column.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [],
  );
  const title = text(titleColumn);
  if (!id || !title) return undefined;

  const rest = [...details, ...more.flat()];
  const linked = (page: string) => rest.filter(run => pageType(run) === page).map(run => run.text ?? '');
  const artists = linked(ARTIST_PAGE);
  const album = linked(ALBUM_PAGE)[0];
  const fixed = item?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs ?? [];
  const durationMs = milliseconds(details.at(-1)?.text) ?? milliseconds(text(fixed));
  return {
    id,
    title,
    artists: artists.length > 0 ? artists : unlinkedArtists(details),
    ...(album ? { album } : {}),
    ...(durationMs ? { durationMs } : {}),
    ...(kind ? { kind } : {}),
  };
}

export function text(runs: Run[]): string {
  return runs.map(run => run.text ?? '').join('').trim();
}

function pageType(run: Run): string {
  return run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
}

/** When no artist is linked, the text before the first " • " names them. */
function unlinkedArtists(details: Run[]): string[] {
  const first = text(details).split(' • ')[0]?.trim();
  return first ? [first] : [];
}

function milliseconds(value: string | undefined): number | undefined {
  const match = value && DURATION.exec(value.trim());
  if (!match) return undefined;
  // m:ss, or h:mm:ss for long ones.
  const [, first, second, third] = match;
  const seconds = third === undefined ? Number(first) * 60 + Number(second) : Number(first) * 3600 + Number(second) * 60 + Number(third);
  return seconds * 1000;
}
