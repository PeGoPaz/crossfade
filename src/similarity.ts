/**
 * How alike two titles or two lists of artists are, from 0 (nothing in
 * common) to 1 (the same). Both take keys made by key() in text.ts.
 *
 * The measure is edit distance: how many letters must be added, removed or
 * changed to turn one into the other, divided by the longer length. It
 * forgives a typo in a long title and not a different word in a short one.
 */

/** The number of single-letter edits that turn a into b (Levenshtein distance). */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  // Only two rows of the table are needed: the one above and the current one.
  let above = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      const change = x[i - 1] === y[j - 1] ? 0 : 1;
      row[j] = Math.min(above[j]! + 1, row[j - 1]! + 1, above[j - 1]! + change);
    }
    above = row;
  }
  return above[y.length]!;
}

function ratio(a: string, b: string): number {
  const longer = Math.max([...a].length, [...b].length);
  return longer === 0 ? 1 : 1 - editDistance(a, b) / longer;
}

/**
 * Spellings that differ only in how Cyrillic was put into Latin letters:
 * Tsoi and Tsoy, Yolka and Elka, Mumiy Troll and Mumii Troll. Applied in
 * order, to both sides, before a second comparison.
 */
const LOOSE: [RegExp, string][] = [
  [/shch|sch/g, 'sh'],
  [/kh/g, 'h'],
  [/ts|tz/g, 'c'],
  [/yo|ye|jo|je/g, 'e'],
  [/yu|ju/g, 'u'],
  [/ya|ja/g, 'a'],
  [/[yj]/g, 'i'],
  [/w/g, 'v'],
  [/ph/g, 'f'],
  [/(.)\1/g, '$1'], // Filipp and Filip
];

function loose(text: string): string {
  return LOOSE.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

/** How alike two keys are, allowing for different ways of spelling Cyrillic in Latin letters. */
export function similarity(a: string, b: string): number {
  return Math.max(ratio(a, b), ratio(loose(a), loose(b)));
}

/**
 * How alike two lists of artists are. Services list artists differently:
 * one names only the main artist, the other adds everyone featured, and one
 * may have "Simon & Garfunkel" as a single name where the other has two. So
 * each artist of the shorter list is looked for in the longer one, and the
 * lists are also compared as whole lines; the better of the two counts.
 */
export function artistSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const found = shorter.map(name => Math.max(...longer.map(other => similarity(name, other))));
  const each = found.reduce((sum, value) => sum + value, 0) / found.length;
  const whole = similarity(line(a), line(b));
  return Math.max(each, whole);
}

/** All the words of a list of names, in alphabetical order, so the order of the names does not matter. */
function line(names: string[]): string {
  return names.join(' ').split(' ').sort().join(' ');
}
