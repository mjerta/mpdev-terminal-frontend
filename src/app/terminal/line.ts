/**
 * Which prompt a line was typed at, or none at all. `primary` is PS1 (the
 * starship-flavoured prompt), `continuation` is PS2 (what bash shows after a
 * trailing backslash), and `output` is machine text a command printed, which
 * carries no prompt.
 *
 * `neofetch` is the one entry that is not text at all: it is a placeholder for a
 * component, because that report is a logo plus a two-column layout and cannot be
 * expressed as the monospace lines `output` is limited to. Everything else stays
 * a string on purpose, so the common case keeps needing no cell measurement.
 */
export type LineKind = 'primary' | 'continuation' | 'output' | 'neofetch';

/** One physical line of scrollback, in the shape the template renders it. */
export interface RenderLine {
  readonly text: string;
  readonly kind: LineKind;
  /**
   * For `neofetch` only: app uptime when the block was printed.
   *
   * Captured here rather than read from the live clock at render time, because a
   * report is a snapshot. Scrolling back to a block printed ten minutes ago must
   * still say "12s", the way the terminal printed it.
   */
  readonly uptimeMs?: number;
  /**
   * For a primary prompt: whether the previous command had failed at the moment
   * this line was echoed, which decides `❯` vs `✗`.
   *
   * Stored per line rather than read from live state, because a prompt already on
   * screen cannot change retroactively. Captured on the primary line only;
   * continuation and output lines never render a success symbol.
   */
  readonly failed?: boolean;
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
