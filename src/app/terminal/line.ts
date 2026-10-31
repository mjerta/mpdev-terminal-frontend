/**
 * Which prompt a line was typed at. `primary` is PS1 (the starship-flavoured
 * prompt), `continuation` is PS2 (what bash shows after a trailing backslash or
 * an unfinished construct).
 */
export type LineKind = 'primary' | 'continuation';

/** One physical line of scrollback, in the shape the template renders it. */
export interface RenderLine {
  readonly text: string;
  readonly kind: LineKind;
}

/** A persisted line. `seq` is filled in by IndexedDB's autoIncrement on read. */
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
