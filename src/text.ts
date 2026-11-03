/**
 * Titles and artist names brought to one form, so that a recording written
 * differently on Yandex Music and on YouTube Music compares equal.
 *
 * key() is the form for comparing: lower case, no accents or punctuation,
 * Cyrillic in Latin letters. parseTitle() also takes the notes out of a title -
 * (Live), - Remastered 2011, (feat. ...), (Official Video) - and says what they
 * mean, because a live recording or a remix is not the track that was liked.
 */

/** What a version note says about a recording. */
export type Version =
  | 'live'
  | 'remix'
  | 'extended'
  | 'edit'
  | 'acoustic'
  | 'instrumental'
  | 'karaoke'
  | 'cover'
  | 'demo'
  | 'sped up'
  | 'slowed'
  | 'remaster';

export interface Title {
  /** key() of the title without its version notes and featured artists. */
  name: string;
  /** What the notes say about the recording, in alphabetical order. */
  versions: Version[];
  /** key() of each artist the title names after feat. or ft. */
  featuring: string[];
}

/** Letters that Unicode does not split into a base letter and an accent. */
const LETTERS: Record<string, string> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th', ı: 'i',
};

/**
 * Cyrillic in Latin letters, close to how the international services spell
 * Russian names. й and ё lose their marks first and arrive here as и and е,
 * which gives Tsoi and Elka - spellings vary anyway, so the comparison that
 * uses these keys has to allow for small differences.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // Ukrainian, Belarusian and Serbian letters that Russian lacks.
  і: 'i', є: 'ye', ґ: 'g', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz',
};

/** Words that join names - "Rock & Roll", "Rock 'n' Roll", "Rock and Roll". */
const CONNECTORS = new Set(['and', 'n', 'и']);

/** The words of a text in lower case, without accents or punctuation, in their own alphabet. */
function words(text: string): string[] {
  return text
    .normalize('NFKD') // ﬁ -> fi, full-width -> plain, é -> e + accent
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘ʼ`´]/g, '') // don't -> dont, not "don t"
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function latin(word: string): string {
  return [...word].map(letter => LETTERS[letter] ?? CYRILLIC[letter] ?? letter).join('');
}

/** A title or a name in the form used for comparing. */
export function key(text: string): string {
  return words(text)
    .filter(word => !CONNECTORS.has(word))
    .map(latin)
    .join(' ');
}

/**
 * Version notes, matched against the note's words joined by single spaces
 * with a space at each end, so ' live ' finds the whole word only.
 */
const VERSIONS: [Version, RegExp][] = [
  ['live', / (live|unplugged|концерт\S*|живое|вживую|лайв) /],
  ['remix', / (re-?mix\S*|rmx|ремикс\S*|rework|bootleg) |(?<! (original|extended|radio|album)) mix /],
  ['extended', / (extended|удлин\S*) /],
  ['edit', / (edit|radio mix|radio version|single version|short version) /],
  ['acoustic', / (acoustic\S*|акустик\S*|unplugged) /],
  ['instrumental', / (instrumental|инструментал\S*|минус|backing track) /],
  ['karaoke', / (karaoke|караоке) /],
  ['cover', / (cover|кавер\S*) /],
  ['demo', / (demo|демо) /],
  ['sped up', / (sped up|speed up|nightcore|ускорен\S*) /],
  ['slowed', / (slowed|reverb|замедлен\S*) /],
  ['remaster', / (remaster\S*|ремастер\S*) /],
];

/** Notes made only of these words (and years) say nothing about the recording. */
const NOISE = new Set([
  'official', 'video', 'audio', 'music', 'lyric', 'lyrics', 'visualizer', 'visualiser',
  'hd', 'hq', '4k', '8k', '1080p', '720p', 'mv', 'clip', 'videoclip', 'upgrade', 'premiere',
  'клип', 'видеоклип', 'премьера', 'explicit', 'clean', 'original', 'album', 'version', 'mix',
  'bonus', 'track', 'deluxe', 'edition', 'mono', 'stereo',
]);

/** Notes that name a film, a producer or a soundtrack. */
const ABOUT = /^ (from|из|ost|soundtrack|саундтрек\S*|theme from|prod|produced by) /;

const FEATURING = /^\s*(?:feat\.?|ft\.?|featuring|with|при\s+уч(?:астии|\.)?)\s+(.+)$/iu;
const FEATURING_IN_TITLE = /\s(?:feat\.?|ft\.?|featuring)\s+(.+)$/iu;
const ARTIST_LIST = /\s*,\s*|\s+(?:&|and|и|x)\s+/iu;

type Note =
  | { kind: 'versions'; versions: Version[] }
  | { kind: 'featuring'; artists: string[] }
  | { kind: 'noise' }
  | { kind: 'title' }; // not a note after all: part of the title, like (Part 2)

function readNote(text: string): Note {
  const featuring = FEATURING.exec(text);
  if (featuring) {
    return { kind: 'featuring', artists: artistKeys(featuring[1] ?? '') };
  }
  const noteWords = words(text);
  const note = ` ${noteWords.join(' ')} `;
  const versions = VERSIONS.filter(([, pattern]) => pattern.test(note)).map(([version]) => version);
  if (versions.length > 0) {
    return { kind: 'versions', versions };
  }
  if (ABOUT.test(note) || noteWords.every(word => NOISE.has(word) || /^\d+$/.test(word))) {
    return { kind: 'noise' };
  }
  return { kind: 'title' };
}

function artistKeys(list: string): string[] {
  return list.split(ARTIST_LIST).map(key).filter(Boolean);
}

const BRACKETS = /[([]([^()[\]]*)[)\]]/g;
const DASH_NOTE = /\s[-–—]\s([^-–—]+)$/;

/**
 * Splits a title into its name, its version notes and featured artists.
 * Yandex Music keeps the version apart from the title; pass it as `version`
 * and it is read like a note in brackets.
 */
export function parseTitle(title: string, version?: string): Title {
  const versions = new Set<Version>();
  const featuring = new Set<string>();
  const notes: string[] = version ? [version] : [];
  let rest = title.normalize('NFKC');

  // Innermost brackets first. A note that turns out to be part of the title
  // keeps its words, and the brackets around it are read on the next pass.
  let found = true;
  while (found) {
    found = false;
    rest = rest.replace(BRACKETS, (_, text: string) => {
      found = true;
      return apply(text) ? ' ' : ` ${text} `;
    });
  }
  // "Title - Remastered 2011". A dash before anything else stays: in
  // "Artist - Title" both halves matter.
  let dash = DASH_NOTE.exec(rest);
  while (dash && apply(dash[1] ?? '')) {
    rest = rest.slice(0, dash.index);
    dash = DASH_NOTE.exec(rest);
  }
  const inTitle = FEATURING_IN_TITLE.exec(rest);
  if (inTitle) {
    artistKeys(inTitle[1] ?? '').forEach(artist => featuring.add(artist));
    rest = rest.slice(0, inTitle.index);
  }
  for (const note of notes) {
    if (!apply(note)) {
      rest += ` ${note}`;
    }
  }

  return {
    // A title made only of notes, like "(Intro)" read as noise, still needs a name.
    name: key(rest) || key(title),
    versions: [...versions].sort(),
    featuring: [...featuring],
  };

  /** Records what a note says; false if it is part of the title. */
  function apply(text: string): boolean {
    const note = readNote(text);
    if (note.kind === 'versions') note.versions.forEach(v => versions.add(v));
    if (note.kind === 'featuring') note.artists.forEach(a => featuring.add(a));
    return note.kind !== 'title';
  }
}
