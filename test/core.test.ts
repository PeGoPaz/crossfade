import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The modules the Firefox extension is to share with the command line: the
 * matching rules, the file formats, the import plan, and the two services.
 * They have to run in a browser, so neither they nor anything they load at
 * run time may use Node's modules or globals. Files, the terminal and the
 * credential store stay on the command line's side.
 */
const CORE = [
  'albums', 'csv', 'decide', 'library', 'matches', 'plan', 'requests', 'score', 'similarity', 'text', 'words',
  'yandex/client', 'yandex/library', 'yandex/signin',
  'ytmusic/library', 'ytmusic/rows', 'ytmusic/search', 'ytmusic/session', 'ytmusic/write',
];

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** What a file loads when it runs: its imports and re-exports, without `import type`, which disappears. */
function runtimeImports(code: string): string[] {
  const found: string[] = [];
  for (const [, clause, from] of code.matchAll(/^(?:import|export)\s+([^'";]*?)\s*from\s*'([^']+)'/gm)) {
    if (/^type\b/.test(clause!)) continue;
    found.push(from!);
  }
  for (const [, bare] of code.matchAll(/^import\s+'([^']+)'/gm)) found.push(bare!);
  for (const [, dynamic] of code.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) found.push(dynamic!);
  return found;
}

/** Every Node module a core file reaches, with the chain of files that leads to it. */
function nodeModulesReached(start: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string, path: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = readFileSync(file, 'utf8');
    const chain = [...path, relative(SRC, file)];
    for (const name of runtimeImports(code)) {
      if (name.startsWith('.')) visit(join(dirname(file), name), chain);
      else problems.push(`${chain.join(' -> ')} imports ${name}`);
    }
    for (const global of ['process', 'Buffer', '__dirname', 'require']) {
      if (new RegExp(`\\b${global}\\b(?!:)`).test(code.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) {
        problems.push(`${chain.join(' -> ')} uses ${global}`);
      }
    }
  };
  visit(join(SRC, `${start}.ts`), []);
  return problems;
}

describe('the core shared with the browser extension', () => {
  for (const module of CORE) {
    test(`${module} runs without Node`, () => {
      assert.deepEqual(nodeModulesReached(module), []);
    });
  }

  test('runtime imports are told from type-only ones', () => {
    const code = [
      "import { readFile } from 'node:fs/promises';",
      "import type { Io } from './cli.ts';",
      "import { type Deps, defaultDeps } from './deps.ts';",
      "export { key } from './text.ts';",
      "export type { Track } from './library.ts';",
      "import './setup.ts';",
      "const lazy = await import('./later.ts');",
    ].join('\n');
    assert.deepEqual(runtimeImports(code), ['node:fs/promises', './deps.ts', './text.ts', './setup.ts', './later.ts']);
  });

  test('a file that reaches Node is caught, with the way it gets there', () => {
    assert.match(nodeModulesReached('report').join('\n'), /^report\.ts imports node:fs\/promises$/m);
    assert.match(nodeModulesReached('match').join('\n'), /^match\.ts -> files\.ts imports node:fs\/promises$/m);
  });
});
