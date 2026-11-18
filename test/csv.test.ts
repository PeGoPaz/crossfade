import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { toCsv } from '../src/csv.ts';

describe('CSV', () => {
  test('starts with a byte order mark and ends lines in CRLF', () => {
    assert.equal(toCsv([['artist', 'title'], ['Кино', 'Группа крови']]), '\uFEFFartist,title\r\nКино,Группа крови\r\n');
  });

  test('quotes fields with commas, quotes and line breaks', () => {
    assert.equal(toCsv([['Earth, Wind & Fire', 'The "Wall"', 'one\ntwo', 'plain']]), '\uFEFF"Earth, Wind & Fire","The ""Wall""","one\ntwo",plain\r\n');
  });

  test('keeps spreadsheets from reading a field as a formula', () => {
    assert.equal(toCsv([['+44', '=1+1', '-', '@home', 'a = b']]), "\uFEFF'+44,'=1+1,'-,'@home,a = b\r\n");
    assert.equal(toCsv([['=HYPERLINK("x","y")']]), '\uFEFF"\'=HYPERLINK(""x"",""y"")"\r\n');
  });

  test('empty fields and rows', () => {
    assert.equal(toCsv([['', 'x', '']]), '\uFEFF,x,\r\n');
    assert.equal(toCsv([]), '\uFEFF');
  });
});
