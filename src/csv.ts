/**
 * A table as CSV that spreadsheets open as it is meant (RFC 4180): fields
 * with a comma, a quote or a line break are quoted, lines end in CRLF, and
 * the text starts with a byte order mark, without which Excel reads UTF-8 as
 * the local code page and turns Cyrillic into nonsense.
 *
 * A field that starts with =, +, - or @ is read by spreadsheets as a formula -
 * the band +44 would come out as a number, and a crafted title could run one.
 * Such fields get a leading apostrophe, which spreadsheets show as text.
 */

export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => `${row.map(field).join(',')}\r\n`).join('')}`;
}

function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
