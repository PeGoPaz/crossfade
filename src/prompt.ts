/** Asking a person at the terminal, one line at a time. */

import { createInterface } from 'node:readline';

/** Shows a prompt and returns the line typed, or undefined when input has ended. */
export type Ask = (prompt: string) => Promise<string | undefined>;

/**
 * Answers typed in the terminal. Open it only when there is something to
 * ask, and close it after: an open terminal keeps crossfade from exiting.
 */
export function terminal(): { ask: Ask; close: () => void } {
  const readline = createInterface({ input: process.stdin });
  const lines = readline[Symbol.asyncIterator]();
  return {
    ask: async prompt => {
      process.stdout.write(prompt);
      const next = await lines.next();
      return next.done ? undefined : next.value;
    },
    close: () => readline.close(),
  };
}
