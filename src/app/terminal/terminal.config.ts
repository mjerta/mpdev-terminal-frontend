/**
 * Fictional system information for the prototype terminal.
 *
 * Nothing here is discovered from the real host: it is a hand-written map that
 * describes what the fake prompt should claim, and the same shape a real
 * backend/PTY would eventually fill in. The font values are pushed onto the
 * host element as custom properties, which is what the Tailwind
 * `font-terminal` / `text-terminal` / `leading-terminal` utilities read.
 */
export interface TerminalConfig {
  readonly user: string;
  readonly host: string;
  readonly cwd: string;
  readonly promptSymbol: string;
  /**
   * The continuation marker, i.e. PS2. Starship leaves PS2 alone, so a real
   * shell falls back to bash's `>`; we mirror that rather than invent a style.
   */
  readonly continuationSymbol: string;
  readonly font: {
    readonly family: string;
    readonly size: string;
    readonly lineHeight: string;
  };
  readonly cursor: {
    /** Full blink cycle. Half on, half off, with hard edges. */
    readonly blinkMs: number;
    /** How long the caret stays solid after a keystroke. */
    readonly steadyAfterKeyMs: number;
  };
}

export const FICTIONAL_TERMINAL: TerminalConfig = {
  user: 'mjerta',
  host: 'surface',
  cwd: '~/develop/projects/mpdev-terminal-frontend',
  promptSymbol: '❯',
  continuationSymbol: '>',
  font: {
    // Same stack as @theme in styles/terminal.scss; this one wins at runtime.
    family:
      "'JetBrainsMono Nerd Font', 'JetBrainsMono NF', 'Adwaita Mono', ui-monospace, monospace",
    size: '0.9375rem',
    lineHeight: '1.45',
  },
  cursor: {
    blinkMs: 1060,
    steadyAfterKeyMs: 500,
  },
};
