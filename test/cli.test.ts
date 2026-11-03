import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { promisify } from 'node:util';

import { COMMANDS, type Command, type Input, run } from '../src/cli.ts';

/** Runs the command line and returns its exit code and what it printed. */
async function cli(argv: string[], commands?: Command[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: text => out.push(text), err: text => err.push(text) }, commands);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('crossfade', () => {
  test('help lists every command', async () => {
    const { code, out, err } = await cli(['help']);
    assert.equal(code, 0);
    assert.equal(err, '');
    for (const command of COMMANDS) {
      assert.match(out, new RegExp(`^  ${command.name}\\b.*${command.summary}`, 'm'));
    }
    assert.match(out, /^ {2}login <service> {2}Sign in/m);
  });

  test('without a command it shows the list as an error', async () => {
    const { code, out, err } = await cli([]);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /^Usage: crossfade <command>/m);
  });

  test('the help of one command shows its options and their defaults', async () => {
    const expected = [
      'Usage: crossfade import [options]',
      '',
      'Add the matches to YouTube Music.',
      '',
      'Options:',
      '  --matches <file>  the matches to add (default: matches.json)',
      '  --dry-run         only show what would be done',
    ].join('\n');
    assert.deepEqual(await cli(['help', 'import']), { code: 0, out: expected, err: '' });
    assert.deepEqual(await cli(['import', '--help']), { code: 0, out: expected, err: '' });
  });

  test('the help of a command with an argument names its values', async () => {
    const { out } = await cli(['help', 'login']);
    assert.match(out, /^Usage: crossfade login <service>$/m);
    assert.match(out, /^<service> is one of: yandex-music, youtube-music$/m);
  });

  test('--version prints the version from package.json', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.deepEqual(await cli(['--version']), { code: 0, out: `crossfade ${version}`, err: '' });
  });

  test('a mistyped command gets a suggestion', async () => {
    assert.deepEqual(await cli(['exprot']), {
      code: 2,
      out: '',
      err: 'crossfade: there is no command "exprot". Did you mean "export"? Run "crossfade help" for the list.',
    });
    assert.match((await cli(['dance'])).err, /no command "dance"\. Run/);
  });

  test('an unknown option or a missing value is a usage error', async () => {
    const unknown = await cli(['export', '--output', 'my.json']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.err, /^crossfade export: Unknown option '--output'/);
    assert.match(unknown.err, /Run "crossfade help export" for more\.$/);
    assert.equal((await cli(['export', '--out'])).code, 2);
  });

  test('arguments are checked against their values', async () => {
    const missing = await cli(['login']);
    assert.equal(missing.code, 2);
    assert.match(missing.err, /^crossfade login: takes <service>$/m);
    const wrong = await cli(['login', 'spotify']);
    assert.match(wrong.err, /^crossfade login: <service> is one of yandex-music, youtube-music, not "spotify"$/m);
    assert.match((await cli(['export', 'now'])).err, /^crossfade export: takes no arguments$/m);
  });

  test('a command that is not written yet says so', async () => {
    const command: Command = { name: 'export', summary: 'Save it' };
    assert.deepEqual(await cli(['export'], [command]), {
      code: 1,
      out: '',
      err: 'crossfade export is not written yet - see the roadmap in README.md',
    });
    assert.match((await cli(['help'], [command])).out, /Save it \(not yet\)/);
  });

  test('a command gets its options, with defaults, and its arguments', async () => {
    let input: Input | undefined;
    const command: Command = {
      name: 'match',
      summary: 'Match',
      args: [{ name: 'service', choices: ['youtube-music'] }],
      options: { out: { placeholder: 'file', default: 'matches.json', help: '' }, 'dry-run': { help: '' } },
      run: async received => {
        input = received;
        return 0;
      },
    };
    assert.equal((await cli(['match', 'youtube-music', '--dry-run'], [command])).code, 0);
    assert.deepEqual(input?.values, { out: 'matches.json', 'dry-run': true });
    assert.deepEqual(input?.positionals, ['youtube-music']);
  });

  test('runs from a terminal', async () => {
    const main = new URL('../src/main.ts', import.meta.url).pathname;
    const { stdout } = await promisify(execFile)(main, ['--version']);
    assert.match(stdout, /^crossfade \d+\.\d+\.\d+\n$/);
  });
});
