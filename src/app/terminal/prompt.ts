/**
 * Prompt segments, built from the shape starship actually produces.
 *
 * Ground truth was read from this machine's `starship prompt` at $HOME with the
 * user's real ~/.config/starship.toml:
 *
 *     ~ ❯        both `~` and `❯` emitted as ESC[1;36m (bold cyan)
 *
 * Two things that measurement settled:
 *
 * - Both segments are the *same* colour, so one emphasis style is enough. The
 *   `[directory]` block sets no `style`, and starship still emitted cyan rather
 *   than its documented `bold blue` default, so inventing two hues here would
 *   have been decoration rather than fidelity.
 * - The real prompt contains no `user@host`: starship only shows those over ssh
 *   or for root. The guest name and `mpdev` are things this prototype wants on
 *   screen, so they are kept and rendered dim, letting the starship part lead.
 *
 * Deliberately free of Angular, so the segment list can be asserted without a
 * browser.
 */
export interface PromptSegment {
  readonly text: string;
  /** Tailwind classes. Trailing spaces live here, not in markup: the Angular
   *  compiler strips whitespace between inline elements, which previously
   *  collapsed the prompt into the text as "❯ls". */
  readonly classes: string;
}

/** `[character] success_symbol` and the directory segment are both bold cyan. */
const EMPHASIS = 'font-bold text-ansi-cyan';

/** starship shows no user@host locally; kept here, deliberately unemphasised. */
const IDENTITY = 'text-muted-foreground';

export interface PromptParts {
  readonly user: string;
  readonly host: string;
  readonly cwd: string;
  readonly symbol: string;
  readonly errorSymbol: string;
  /** True when the previous command exited non-zero, which swaps the glyph. */
  readonly failed: boolean;
  readonly showIdentity: boolean;
}

export function buildPrompt(parts: PromptParts): readonly PromptSegment[] {
  const segments: PromptSegment[] = [];

  if (parts.showIdentity) {
    segments.push({ text: `${parts.user}@${parts.host} `, classes: IDENTITY });
  }

  segments.push(
    { text: `${parts.cwd} `, classes: EMPHASIS },
    // Success and failure share EMPHASIS because the config styles both bold
    // cyan; only the glyph moves. Adding a red error hue would be inventing a
    // rule this prompt's own configuration does not have.
    { text: `${parts.failed ? parts.errorSymbol : parts.symbol} `, classes: EMPHASIS },
  );
  return segments;
}

/**
 * PS2 for a continued line. starship defines no continuation prompt, so a real
 * shell falls back to bash's `> `; that is mirrored rather than styled.
 */
export function buildContinuation(symbol: string): readonly PromptSegment[] {
  return [{ text: `${symbol} `, classes: IDENTITY }];
}
