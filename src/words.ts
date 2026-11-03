/** "1 track", "2 tracks": a number with its noun in the right form. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
