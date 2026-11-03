/**
 * The command line: `crossfade <command> [options]`.
 *
 * Every command is described once, in COMMANDS - its arguments, options and
 * help - and run() reads its options, checks them and prints help from that
 * description. A command without `run` is planned but not written yet.
 *
 * Exit codes: 0 done, 1 failed, 2 the command line itself was wrong.
 */

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { Service } from './credentials.ts';
import { exportLibrary } from './export.ts';
import { importMatches } from './import.ts';
import { login } from './login.ts';
import { matchLibrary } from './match.ts';
import { review } from './review.ts';
import { editDistance } from './similarity.ts';

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export interface Option {
  help: string;
  /** Options with a placeholder take a value: `--out <file>`. The rest are switches. */
  placeholder?: string;
  default?: string;
}

export interface Input {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
  io: Io;
}

export interface Command {
  name: string;
  summary: string;
  /** Required arguments, in order, each with the values it may take. */
  args?: { name: string; choices: string[] }[];
  options?: Record<string, Option>;
  run?: (input: Input) => Promise<number>;
}

const LIBRARY = { placeholder: 'file', default: 'library.json' };
const MATCHES = { placeholder: 'file', default: 'matches.json' };

export const COMMANDS: Command[] = [
  {
    name: 'login',
    summary: 'Sign in to a music service',
    args: [{ name: 'service', choices: ['yandex-music', 'youtube-music'] }],
    run: ({ positionals, io }) => login(positionals[0] as Service, io),
  },
  {
    name: 'export',
    summary: 'Save your Yandex Music library to a file',
    options: { out: { ...LIBRARY, help: 'where to save it' } },
    run: ({ values, io }) => exportLibrary(values.out as string, io),
  },
  {
    name: 'match',
    summary: 'Find each track of the library on YouTube Music',
    options: {
      library: { ...LIBRARY, help: 'the library to read' },
      out: { ...MATCHES, help: 'where to save the matches' },
    },
    run: ({ values, io }) => matchLibrary(values.library as string, values.out as string, io),
  },
  {
    name: 'review',
    summary: 'Decide on the matches crossfade is not sure of',
    options: {
      library: { ...LIBRARY, help: 'the library the matches are for' },
      matches: { ...MATCHES, help: 'the matches to review' },
    },
    run: ({ values, io }) => review(values.library as string, values.matches as string, io),
  },
  {
    name: 'import',
    summary: 'Add the matches to YouTube Music',
    options: {
      library: { ...LIBRARY, help: 'the library the matches are for' },
      matches: { ...MATCHES, help: 'the matches to add' },
      'dry-run': { help: 'only show what would be done' },
    },
    run: ({ values, io }) => importMatches(values.library as string, values.matches as string, values['dry-run'] === true, io),
  },
  {
    name: 'report',
    summary: 'List what could not be moved, and why',
    options: { matches: { ...MATCHES, help: 'the matches to report on' } },
  },
];

const OK = 0;
const FAILED = 1;
const USAGE = 2;

export async function run(argv: string[], io: Io, commands: Command[] = COMMANDS): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined) {
    io.err(overview(commands));
    return USAGE;
  }
  if (name === 'help' || name === '--help' || name === '-h') {
    if (rest[0] === undefined) {
      io.out(overview(commands));
      return OK;
    }
    const command = find(rest[0], commands, io);
    if (!command) return USAGE;
    io.out(help(command));
    return OK;
  }
  if (name === '--version' || name === '-v') {
    io.out(version());
    return OK;
  }

  const command = find(name, commands, io);
  if (!command) {
    return USAGE;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.out(help(command));
    return OK;
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: Object.fromEntries(
        Object.entries(command.options ?? {}).map(([option, { placeholder, default: value }]) => [
          option,
          placeholder ? { type: 'string', ...(value === undefined ? {} : { default: value }) } : { type: 'boolean' },
        ]),
      ),
    });
  } catch (error) {
    return usage(command, (error as Error).message, io);
  }

  const args = command.args ?? [];
  if (parsed.positionals.length !== args.length) {
    const wanted = args.length === 0 ? 'no arguments' : args.map(arg => `<${arg.name}>`).join(' ');
    return usage(command, `takes ${wanted}`, io);
  }
  for (const [i, arg] of args.entries()) {
    const value = parsed.positionals[i]!;
    if (!arg.choices.includes(value)) {
      return usage(command, `<${arg.name}> is one of ${arg.choices.join(', ')}, not "${value}"`, io);
    }
  }

  if (!command.run) {
    io.err(`crossfade ${command.name} is not written yet - see the roadmap in README.md`);
    return FAILED;
  }
  // parseArgs gives an object without a prototype, and no option here is
  // given more than once, so a plain copy is the honest type.
  const values = { ...parsed.values } as Input['values'];
  return command.run({ values, positionals: parsed.positionals, io });
}

function find(name: string, commands: Command[], io: Io): Command | undefined {
  const command = commands.find(c => c.name === name);
  if (!command) {
    const close = commands.find(c => editDistance(c.name, name) <= 2);
    const guess = close ? ` Did you mean "${close.name}"?` : '';
    io.err(`crossfade: there is no command "${name}".${guess} Run "crossfade help" for the list.`);
  }
  return command;
}

function usage(command: Command, problem: string, io: Io): number {
  io.err(`crossfade ${command.name}: ${problem}\n\n${synopsis(command)}\nRun "crossfade help ${command.name}" for more.`);
  return USAGE;
}

function overview(commands: Command[]): string {
  const width = Math.max(...commands.map(c => heading(c).length));
  const lines = commands.map(c => `  ${heading(c).padEnd(width)}  ${c.summary}${c.run ? '' : ' (not yet)'}`);
  return [
    'crossfade - move your Yandex Music library to YouTube Music',
    '',
    'Usage: crossfade <command> [options]',
    '',
    'Commands:',
    ...lines,
    '',
    'Run "crossfade help <command>" for its options, "crossfade --version" for the version.',
  ].join('\n');
}

function help(command: Command): string {
  const lines = [synopsis(command), '', `${command.summary}.`];
  for (const arg of command.args ?? []) {
    lines.push('', `<${arg.name}> is one of: ${arg.choices.join(', ')}`);
  }
  const options = Object.entries(command.options ?? {});
  if (options.length > 0) {
    const flag = ([name, option]: [string, Option]) => `--${name}${option.placeholder ? ` <${option.placeholder}>` : ''}`;
    const width = Math.max(...options.map(o => flag(o).length));
    lines.push('', 'Options:');
    for (const entry of options) {
      const [, option] = entry;
      const value = option.default === undefined ? '' : ` (default: ${option.default})`;
      lines.push(`  ${flag(entry).padEnd(width)}  ${option.help}${value}`);
    }
  }
  return lines.join('\n');
}

function synopsis(command: Command): string {
  return `Usage: crossfade ${heading(command)}${command.options ? ' [options]' : ''}`;
}

function heading(command: Command): string {
  return [command.name, ...(command.args ?? []).map(arg => `<${arg.name}>`)].join(' ');
}

function version(): string {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return `crossfade ${version}`;
}
