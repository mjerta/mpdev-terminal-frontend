/**
 * Which prompt a line was typed at, or none at all. `primary` is PS1 (the
 * starship-flavoured prompt), `continuation` is PS2 (what bash shows after a
 * trailing backslash), and `output` is machine text a command printed, which
 * carries no prompt.
 */
export type LineKind = 'primary' | 'continuation' | 'output';

/** One physical line of scrollback, in the shape the template renders it. */
export interface RenderLine {
  readonly text: string;
  readonly kind: LineKind;
}

/**
 * Count of backslashes at the end of a line. Bash splices a line when that count
 * is odd: `foo \` continues, but `foo \\` is an escaped backslash and submits.
 */
export function trailingBackslashes(line: string): number {
  let count = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) {
    count += 1;
  }
  return count;
}

/**
 * Join a block typed over several lines back into the single command bash would
 * have parsed.
 *
 * Concatenated with no separator and no trimming: submit() already dropped the
 * splicing backslash, and the space that preceded it belongs to the command, so
 * `ls -la \` plus `-lah` has to become `ls -la -lah` rather than `ls -la-lah`.
 */
export function spliceBlock(buffer: string): string {
  return buffer.split('\n').join('');
}
