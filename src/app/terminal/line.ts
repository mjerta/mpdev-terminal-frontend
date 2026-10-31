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
 * A persisted line. Only typed lines are stored: `output` lives in memory, so
 * what survives a reload is the history of commands, not a transcript of the
 * screen. `seq` is filled in by IndexedDB's autoIncrement on read.
 */
export interface StoredLine extends RenderLine {
  readonly at: number;
  readonly seq?: number;
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
