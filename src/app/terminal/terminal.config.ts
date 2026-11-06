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
   * Name the shell reports itself as when a command is not found, i.e. the prefix
   * of `fake-bash: foo: command not found`, and what `neofetch` prints as Shell.
   *
   * Says what it is rather than borrowing the real `$SHELL`: this runs no
   * executable, so calling itself `bash` would be the one place the prototype
   * claims a thing it does not do. The wording and the exit code it produces are
   * still bash's, which is what the rest of this file mirrors.
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
  /**
   * The terminal's own type: size, leading, and the fallback cell ratio.
   *
   * No `family` here. Which face is drawn is a choice the visitor makes with the
   * `font` command, so it lives in `fonts` below and in the signal that carries
   * the selected entry - config holds one answer per fact.
   */
  readonly font: {
    readonly size: string;
    readonly lineHeight: string;
    /**
     * Cell width of the default face as a fraction of the font size.
     *
     * Not cosmetic. The `neofetch` logo is laid out in cells, so its width is
     * `columns * ratio * fontSize`, which decides both the size that keeps 48
     * columns on screen and which sizes put a cell edge exactly on a device
     * pixel. `neofetch` measures the real ratio from the face in use and falls
     * back to this only when measurement is impossible.
     */
    readonly advanceRatio: number;
    /**
     * The face the `neofetch` logo is always drawn in, whatever font is chosen.
     *
     * The logo is not text. It is a grid: 48 columns of blocks, box lines and
     * spaces that each have to be exactly one advance wide, because a run of
     * spaces shifts every column to its right. That only holds if one face
     * supplies every character in it - and no device family can be promised to.
     * Measured on this machine, a lone `ui-monospace` gives a real space 0.25em
     * and the block glyphs 0.709em, so blocks land at two and three quarters times
     * the width of the spaces between them; every row whose space count differs
     * then starts further right than the one above, and the letters lean. A phone
     * shows the same mismatch whenever its own mono lacks the box-drawing range and
     * the browser substitutes one per glyph.
     *
     * So the text obeys the choice and the picture does not. The logo is pinned to
     * the default bundled face. The four other bundled Nerd Fonts are uniform too,
     * but the picture should not move while you are comparing text faces; keeping
     * it fixed is what makes a choice safe to try and walk away from. `fonts.scss`
     * ships these faces rather than hoping for a local copy for the same reason.
     */
    readonly logoFamily: string;
  };
  readonly cursor: {
    /** Full blink cycle. Half on, half off, with hard edges. */
    readonly blinkMs: number;
    /** How long the caret stays solid after a keystroke. */
    readonly steadyAfterKeyMs: number;
  };
  /**
   * How the `neofetch` report arrives on screen.
   *
   * The cadence is per *word*, not per character, and that is what makes it read
   * like streamed output rather than a typewriter: words vary in length, so a
   * fixed interval still lands characters at an irregular rate - which is what a
   * model emitting tokens actually looks like - while the schedule itself stays
   * deterministic enough to test.
   */
  readonly reveal: {
    readonly msPerToken: number;
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
  /**
   * The fonts the `font` command can select. The first entry is the default.
   */
  readonly fonts: readonly FontChoice[];
}

/**
 * One selectable font.
 *
 * `family` is a CSS `font-family` value, so a choice may be a stack rather than a
 * single face - which is how it has to work, since a generic family like
 * `monospace` resolves to something different on every device and the only honest
 * way to describe it is to let the browser answer.
 *
 * Deliberately no `note` field. The `font --list` output is committed scrollback,
 * so it cannot reflow when the window resizes and its rows have to fit the
 * narrowest plausible phone; a description column would push every row past that.
 * The one thing worth warning about is stated once, as its own line, instead.
 */
export interface FontChoice {
  /** What you type: `font nerd`. A single word, because arguments split on spaces. */
  readonly id: string;
  /**
   * The name `font --list` and the report's `Font` row show.
   *
   * Separate from `family` because the CSS value is a whole stack - quotes,
   * fallbacks and all - and because the canonical Nerd Font names are too long for
   * the committed output. `Font: SauceCodePro Nerd Font Mono` is 33 cells, over the
   * 31-cell budget the scrollback has on a phone; `Font: Source Code Pro` is 21.
   * This is the human name, not the declaration.
   */
  readonly label: string;
  readonly family: string;
}

const BUNDLED_STACK =
  "'JetBrainsMono Nerd Font', 'JetBrainsMono NF', 'Adwaita Mono', ui-monospace, monospace";

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
    size: '0.9375rem',
    lineHeight: '1.45',
    /**
     * Cell width of the default face as a fraction of the font size: 600 units
     * per 1000 upem, measured.
     *
     * A fallback, not the answer. The `neofetch` logo measures the real advance
     * from the font actually drawn and uses that; this stands in only where a
     * measurement is impossible, which in practice means a test runner with no
     * layout engine.
     */
    advanceRatio: 0.6,
    // The logo is drawn in this face whatever the visitor chooses; see the interface.
    logoFamily: BUNDLED_STACK,
  },
  fonts: [
    { id: 'nerd', label: 'JetBrains Mono', family: BUNDLED_STACK },
    /*
      Four more Nerd Fonts, bundled rather than hoped for. `fonts.scss` explains
      why they are the `Mono` variants and why each file is subset.

      The `monospace` behind each is the fallback if the woff2 never arrives. It
      is also what keeps a glyph the face lacks - `✗`, the error prompt, is absent
      from all four - on the same pitch instead of handing that cell to whatever
      the browser's default family would use.
    */
    { id: 'fira', label: 'Fira Code', family: "'FiraCode Nerd Font Mono', monospace" },
    {
      id: 'cascadia',
      label: 'Cascadia Mono',
      family: "'CaskaydiaMono Nerd Font Mono', monospace",
    },
    { id: 'hack', label: 'Hack', family: "'Hack Nerd Font Mono', monospace" },
    {
      id: 'sauce',
      label: 'Source Code Pro',
      family: "'SauceCodePro Nerd Font Mono', monospace",
    },
    {
      // No bundled face in this stack on purpose: the point of the choice is to
      // see the device's own mono, and a fallback to ours would quietly undo that.
      // The `monospace` behind it is not decoration either - measured on Linux, a
      // lone `ui-monospace` gives `M` an advance of 0.889em and the block glyphs
      // 0.709em, which is the per-glyph drift the logo exists to avoid. With the
      // fallback the whole set lands on 0.6em and the art stays one grid.
      id: 'system',
      label: 'ui-monospace',
      family: 'ui-monospace, monospace',
    },
    { id: 'mono', label: 'monospace', family: 'monospace' },
  ],
  cursor: {
    blinkMs: 1060,
    steadyAfterKeyMs: 500,
  },
  reveal: {
    // ~27 words in the report, so the whole thing lands in about a second.
    msPerToken: 38,
  },
  system: {
    // The fiction, stated plainly: a browser page presenting itself as a
    // terminal, rather than a browser pretending to be a Linux box.
    os: 'mpdev web terminal',
    kernel: 'web',
    terminal: 'mpdev-terminal',
  },
};
