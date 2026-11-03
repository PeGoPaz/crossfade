#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning
// The crossfade command. Everything it does is in cli.ts; this only connects
// it to the terminal.

import { run } from './cli.ts';

try {
  process.exitCode = await run(process.argv.slice(2), {
    out: text => process.stdout.write(`${text}\n`),
    err: text => process.stderr.write(`${text}\n`),
  });
} catch (error) {
  // A failure the command did not expect: say what it was without a stack
  // trace, unless asked for one.
  process.stderr.write(`crossfade: ${process.env.CROSSFADE_DEBUG ? (error as Error).stack : (error as Error).message}\n`);
  process.exitCode = 1;
}
