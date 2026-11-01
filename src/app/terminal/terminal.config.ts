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
  /**
   * The name before the `@`. Omit it to show a generated guest name; set it to
   * pin one, which is also where a logged-in user or a backend-supplied
   * username belongs.
   */
  readonly user?: string;
  readonly host: string;
  readonly cwd: string;
  readonly promptSymbol: string;
  /**
   * `[character] error_symbol`, shown when the previous command exited non-zero.
   * Your config renders it bold cyan exactly like success_symbol, so only the
   * glyph changes: `✗` rather than `❯`.
   */
  readonly errorSymbol: string;
  /**
   * Name the shell reports itself as when a command is not found, matching
   * `bash: foo: command not found`. Your `$SHELL` is bash, so this mirrors the
   * machine the fiction is standing in for.
   */
  readonly shell: string;
  /**
   * The continuation marker, i.e. PS2. Starship leaves PS2 alone, so a real
   * shell falls back to bash's `>`; we mirror that rather than invent a style.
   */
  readonly continuationSymbol: string;
  /**
   * starship's `add_newline`: a blank line above each prompt, which is most of
   * what makes it read as starship rather than a plain shell.
   */
  readonly addNewline: boolean;
  /**
   * Show `user@host`. Your real config renders neither, because starship only
   * surfaces them over ssh or for root; this prototype wants them on screen, so
   * they are shown dim rather than as part of the starship emphasis.
   */
  readonly showUserHost: boolean;
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
  /**
   * What `neofetch` claims about this machine.
   *
   * Kept in the same map as the prompt so the two cannot describe different
   * machines: the logo says `mpdev`, the prompt says `@mpdev`, and both read this
   * one object.
   *
   * Only things this app can honestly claim. There is no CPU, GPU or memory
   * figure, because the terminal is a page rather than a machine, and inventing a
   * spec block would be the one lie the rest of this prototype avoids: every other
   * number it prints - uptime, command count, resolution - is measured.
   */
  readonly system: {
    readonly os: string;
    readonly kernel: string;
    readonly terminal: string;
  };
}

export const FICTIONAL_TERMINAL: TerminalConfig = {
  // user intentionally unset: guests get a generated name, see settings.store.ts.
  // A project label, not a machine: a browser cannot read a hostname, so this
  // claims nothing about whoever is looking at it.
  host: 'mpdev',
  // Deliberately bare: this is a fictional prompt, so claim only the home
  // directory rather than inventing a path that implies a real checkout.
  cwd: '~',
  promptSymbol: '❯',
  errorSymbol: '✗',
  shell: 'fake-bash',
  continuationSymbol: '>',
  addNewline: true,
  showUserHost: true,
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
  system: {
    // The fiction, stated plainly: a browser page presenting itself as a
    // terminal, rather than a browser pretending to be a Linux box.
    os: 'mpdev web terminal',
    kernel: 'web',
    terminal: 'mpdev-terminal',
  },
};
