import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommandStore } from './command.store';
import { TerminalBoot } from './boot';
import {
  commandNotFound,
  EXIT_NOT_FOUND,
  resolveCommand,
  TerminalCommandContext,
} from './commands';
import { SettingsStore } from './settings.store';
import { LineKind, RenderLine, spliceBlock, trailingBackslashes } from './line';
import { Neofetch } from './neofetch/neofetch';
import { buildContinuation, buildPrompt, PromptSegment } from './prompt';
import { FICTIONAL_TERMINAL, FontChoice, TerminalConfig } from './terminal.config';
import { VisibleViewport } from './visible-viewport';

/** Shared empty array: a stable reference keeps the inner loop from re-rendering. */
const NO_SEGMENTS: readonly PromptSegment[] = [];

/**
 * A fictional terminal: no PTY, no shell, no input element doing the work.
 *
 * Keystrokes are captured by an invisible helper input (so mobile browsers will
 * still raise a keyboard) and rendered from our own buffer. The caret is an
 * inline box that trails the text of the last logical line, so the browser places
 * it for us and no cell math is needed while the caret can only sit at the end.
 *
 * The buffer is one string that may contain newlines. `logicalLines` splits it so
 * each line is rendered as its own paragraph: that keeps "one <p> == one line you
 * typed" true, which is what stops a soft wrap from being confused with a real
 * newline.
 *
 * Two separate things are held here, which is deliberate:
 * - `scrollback` is what is on screen. Session-only, and what `clear` erases.
 * - `commands` is the history of what you typed. Persisted, and untouched by
 *   `clear`. Deriving one from the other is what made `clear` eat history, which
 *   no real shell does.
 */
@Component({
  selector: 'app-terminal',
  templateUrl: './terminal.html',
  styleUrl: './terminal.scss',
  imports: [Neofetch],
})
export class Terminal implements TerminalCommandContext {
  protected readonly config: TerminalConfig = FICTIONAL_TERMINAL;

  /**
   * The active palette id, only used by the `neofetch` report.
   *
   * The prompt itself never needs this: it asks for ANSI colour names and lets the
   * stylesheet resolve them against the theme. A report has to print the name as
   * text, though, so the id is passed down from the container that owns it.
   */
  readonly theme = input('tokyo-night');

  /** Lines on screen, oldest first. Empty entries are kept: a shell still shows a prompt. */
  protected readonly scrollback = signal<readonly RenderLine[]>([]);
  /** The persisted command history, oldest first. */
  private readonly commands = signal<readonly string[]>([]);
  /** How many commands have been remembered. `neofetch` reports it. */
  protected readonly commandCount = computed(() => this.commands().length);
  /** What is currently typed after the prompt; may span several lines. */
  protected readonly input = signal('');

  /** Solid rather than blinking for a moment after each keystroke. */
  protected readonly typing = signal(false);
  private typingTimer: ReturnType<typeof setTimeout> | undefined;

  /** Whether the view is parked at the bottom, which decides if we auto-follow. */
  private atBottom = true;

  /** One-shot guard: the startup `neofetch` is printed at most once per session. */
  private motdShown = false;

  /**
   * The family in use, which starts as the config default and ends wherever the
   * `font` command puts it.
   *
   * A signal rather than a field because the published CSS property, the report's
   * `Font` row and the command's own reply all read it, and all three have to agree
   * at any moment - including mid-session after a `font mono`.
   */
  protected readonly fontChoice = signal<FontChoice>(FICTIONAL_TERMINAL.fonts[0]);
  /** What IndexedDB holds, as opposed to what is on screen. Null when never saved. */
  private readonly savedFont = signal<string | null>(null);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly capture = viewChild<ElementRef<HTMLInputElement>>('capture');
  private readonly settings = inject(SettingsStore);
  private readonly boot = inject(TerminalBoot);

  /** Read only for its `height` signal, which the scroll pin depends on. */
  private readonly viewport = inject(VisibleViewport);
  private readonly store = inject(CommandStore);
  /**
   * This visitor's name, loaded from IndexedDB. `guest` shows for the moment
   * before it resolves, because IndexedDB reads are asynchronous where a
   * configured `user` is not.
   */
  private readonly guest = signal<string | null>(null);

  /** A configured user pins the name; otherwise guests get a generated one. */
  protected readonly user = computed(() => this.config.user ?? this.guest() ?? 'guest');

  /*
    The prompt is a list of styled segments rather than one string, because that
    is the shape starship actually emits: each module carries its own style. The
    builder is in prompt.ts and records what `starship prompt` really produced on
    this machine. Trailing spaces live inside the segment text, since the Angular
    compiler strips whitespace between inline elements.
  */
  /**
   * Exit status of the last command, null until one has run. starship's whole
   * success/error symbol mechanism rests on this, so it is kept explicitly
   * rather than as a boolean: a real `$?` is a number.
   */
  private readonly lastStatus = signal<number | null>(null);

  /** Null means "nothing has run yet", which is not a failure. */
  private readonly failed = computed(() => {
    const status = this.lastStatus();
    return status !== null && status !== 0;
  });

  /**
   * Both prompt variants, built once and cached.
   *
   * Two arrays rather than one, so each committed line keeps the glyph it was
   * echoed with while the live line follows the current status. A single
   * status-driven array is the bug this avoids: every prompt in the scrollback
   * would flip to `✗` the first time a command failed.
   */
  private readonly promptVariants = computed(() => {
    const shared = {
      user: this.user(),
      host: this.config.host,
      cwd: this.config.cwd,
      symbol: this.config.promptSymbol,
      errorSymbol: this.config.errorSymbol,
      /*
        Withheld until the identity source has answered. The placeholder name would
        otherwise read as a settled answer: `guest@mpdev` is indistinguishable from
        a real guest that happens to be called "guest".

        Keyed on this one source rather than overall readiness, so a slow or missing
        unrelated source (a theme, a history) cannot hide the visitor's name forever.
      */
      showIdentity: this.config.showUserHost && this.boot.has('identity'),
    };
    return {
      ok: buildPrompt({ ...shared, failed: false }),
      failed: buildPrompt({ ...shared, failed: true }),
    };
  });

  /** PS2 for continuation lines. */
  protected readonly continuationSegments = computed(() =>
    buildContinuation(this.config.continuationSymbol),
  );

  /**
   * Segments for a committed line. Takes the whole line, not just its kind,
   * because the glyph depends on the status recorded when it was echoed. Output
   * lines get a shared empty array, and every branch returns a stable reference
   * so the inner loop does not re-render on unrelated change detection.
   */
  protected segmentsFor(line: RenderLine): readonly PromptSegment[] {
    if (line.kind === 'primary')
      return line.failed ? this.promptVariants().failed : this.promptVariants().ok;
    if (line.kind === 'continuation') return this.continuationSegments();
    return NO_SEGMENTS;
  }

  /** The line being typed: PS1 on its first line, PS2 on any that follow. */
  protected liveSegments(isFirst: boolean): readonly PromptSegment[] {
    if (!isFirst) return this.continuationSegments();
    return this.failed() ? this.promptVariants().failed : this.promptVariants().ok;
  }

  /**
   * Whether this line gets starship's `add_newline` gap above it: primary
   * prompts only, since continuation and output lines belong to the block above.
   *
   * That includes the very first prompt of a session. Checked against the real
   * thing rather than assumed: `starship prompt` at $HOME emits a leading
   * newline before any prompt, so starting with one gap is the faithful
   * behaviour, not a stray blank line.
   */
  protected readonly showsGapBefore = (kind: LineKind): boolean =>
    this.config.addNewline && kind === 'primary';

  /** Always at least one entry, so the caret has a line to sit on. */
  protected readonly logicalLines = computed(() => this.input().split('\n'));

  /**
   * What to show in place of typed text while stored state is still arriving.
   *
   * Empty once anything has been typed, so a slow boot can never overwrite or sit
   * under what the visitor is actually entering.
   */
  protected readonly bootHint = computed(() =>
    this.input() === '' && this.boot.showLoader() ? this.boot.hint() : '',
  );

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    destroyRef: DestroyRef,
  ) {
    destroyRef.onDestroy(() => clearTimeout(this.typingTimer));

    // Publish the config as the custom properties the Tailwind utilities read.
    // --animate-caret is written as the whole shorthand on purpose: a nested
    // var() in the token would be substituted at :root and could not be retuned
    // from here.
    //
    // Two families, deliberately. `--font-terminal` follows the visitor's choice and
    // is what the text, the caret and the report are drawn in. `--font-logo` does not
    // move: the `neofetch` art is a grid of cells, and a device family that has to
    // substitute a face for the box-drawing range puts those cells on a different
    // pitch from its own spaces, which is the lean. The picture stays in the one face
    // known to be uniform; see `font.logoFamily`.
    effect(() => {
      const { font, cursor } = this.config;
      const style = this.host.nativeElement.style;
      style.setProperty('--font-terminal', this.fontChoice().family);
      style.setProperty('--font-logo', font.logoFamily);
      style.setProperty('--text-terminal', font.size);
      style.setProperty('--leading-terminal', font.lineHeight);
      style.setProperty('--animate-caret', `caret-blink ${cursor.blinkMs}ms step-end infinite`);
    });

    // Keep the newest line in view.
    //
    // This must be afterRenderEffect, not effect: the scroll write reads
    // scrollHeight, and a plain effect runs while the new lines are still in
    // pending DOM operations. It then measures the *old* height, writes a number
    // that the browser clamps to the pre-update bottom, and silently leaves the
    // newest line off screen. Reading the signals here registers them as
    // dependencies, so this runs again after every edit.
    //
    // viewport.height() is read for the same reason: when the on-screen keyboard
    // opens, the text has not changed but the shell has just become much
    // shorter, and without this the caret line would stay pinned below the fold.
    afterRenderEffect(() => {
      this.scrollback();
      this.input();
      this.viewport.height();
      const el = this.scroller()?.nativeElement;
      // Only follow the output if the user is already parked at the bottom, so
      // scrolling back through the log is not yanked away by the next line.
      if (el && this.atBottom) el.scrollTop = el.scrollHeight;
    });

    void this.restore();

    /*
      The MOTD: one `neofetch` block, printed the moment the boot screen lifts.

      The scrollback length is read through `untracked` on purpose. This effect has
      to fire on the reveal, not on every later scrollback edit; tracking the length
      would re-run it each time a command printed something, leaving the one-shot
      flag as the only thing between the visitor and a second copy.

      Skipped when the scrollback is not empty: a command committed during the dwell
      is already on screen, and a report pushed under it would read as that command's
      output rather than as the greeting it is.
    */
    effect(() => {
      if (!this.boot.revealed() || this.motdShown) return;
      if (untracked(() => this.scrollback().length) > 0) return;
      this.motdShown = true;
      this.showNeofetch();
    });

    // Both reads can land after the view is gone, so guard the writes.
    let alive = true;
    destroyRef.onDestroy(() => {
      alive = false;
    });
    if (this.config.user) {
      // Nothing to look up, but the source still counts as settled.
      this.boot.mark('identity');
    } else {
      void this.settings.guestName().then((name) => {
        /*
          Marked unconditionally: this is app-level readiness, not view state, so a
          view torn down mid-read must not leave the loader waiting forever.
        */
        this.boot.mark('identity');
        if (alive) this.guest.set(name);
      });
    }

    /*
      The chosen font, read the same way the name is.

      Marking `font` as a boot source is what makes the stored choice the *first*
      one painted: the loader does not lift until this read answers, so there is no
      swap visible under it. Without the mark the terminal would boot in the default
      face and change every cell on screen a beat later.

      An id that is not in the catalogue is dropped rather than trusted - the same
      rule the container applies to a theme that has since been removed. It is not
      remembered as saved either: a choice that cannot be applied is not one the
      reload will bring back, so reporting it would promise something the app cannot
      do.
    */
    void this.settings.load<string>(SettingsStore.FONT).then((stored) => {
      this.boot.mark('font');
      const choice = FICTIONAL_TERMINAL.fonts.find((candidate) => candidate.id === stored);
      if (!alive || !choice) return;
      this.fontChoice.set(choice);
      this.savedFont.set(choice.id);
    });
  }

  /**
   * Load the saved command history. Prepending rather than setting means a command
   * recorded while the read is in flight cannot be lost, whichever order the two
   * resolve in.
   *
   * The screen itself is not restored: reloading opens a fresh session with a
   * blank scrollback and the full history behind it, which is what opening a new
   * terminal tab does.
   */
  private async restore(): Promise<void> {
    const stored = await this.store.load();
    /*
      Marked before the early return: boot has to complete whether or not there
      was anything to restore, otherwise an empty history would leave the loader
      hanging on a source that is never going to answer.
    */
    this.boot.mark('history');
    if (stored.length === 0) return;
    this.commands.update((current) => [...stored.map((command) => command.text), ...current]);
  }

  /** Track whether the user is at the bottom, which decides if we auto-follow. */
  protected onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
  }

  protected focusCapture(): void {
    this.capture()?.nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.settleCaret();

    if (event.key === 'Enter') {
      event.preventDefault();
      // Shift+Enter breaks the line without submitting. A soft keyboard has no
      // shift+Enter at all, so mobile relies on the backslash path instead.
      if (event.shiftKey) {
        this.newline();
      } else {
        void this.submit();
      }
      return;
    }

    // With a real keyboard the capture input is always empty, so Backspace
    // produces no beforeinput event and has to be handled here. When it does
    // hold text (mid-composition) we let beforeinput handle it instead.
    if (event.key === 'Backspace' && !event.isComposing && this.captureValue() === '') {
      event.preventDefault();
      // When the buffer ends in a newline this deletes it, which rejoins the two
      // lines — the same thing a real terminal does.
      this.pop();
    }
  }

  protected onBeforeInput(event: Event): void {
    const inputEvent = event as InputEvent;
    const type = inputEvent.inputType;

    // Everything is preventDefault-ed: the buffer is the single source of truth
    // and the helper input is never allowed to accumulate text.
    if (type === 'insertParagraph') {
      event.preventDefault();
      this.settleCaret();
      void this.submit();
      return;
    }

    if (type === 'insertLineBreak') {
      event.preventDefault();
      this.settleCaret();
      this.newline();
      return;
    }

    if (type === 'deleteContentBackward' || type === 'deleteWordBackward') {
      event.preventDefault();
      this.settleCaret();
      if (type === 'deleteWordBackward') {
        this.input.update((text) => text.replace(/\S+\s*$/, ''));
      } else {
        this.pop();
      }
      return;
    }

    if (type.startsWith('insert')) {
      event.preventDefault();
      const text = inputEvent.data;
      if (text) {
        this.settleCaret();
        this.input.update((current) => current + text);
      }
    }
  }

  /** Safety net: autocorrect can still write to the element behind our back. */
  protected onInput(event: Event): void {
    const el = event.target as HTMLInputElement;
    if (el.value) el.value = '';
  }

  private captureValue(): string {
    return this.capture()?.nativeElement.value ?? '';
  }

  private pop(): void {
    this.input.update((text) => text.slice(0, -1));
  }

  private newline(): void {
    this.input.update((buffer) => `${buffer}\n`);
  }

  /**
   * Enter without shift. A line whose trailing backslash count is odd is
   * unfinished in bash's eyes, so drop that one backslash and keep typing on the
   * next line. An even count means the backslash was escaped (`foo \\`) and the
   * block is complete.
   *
   * Bash splices `\<newline>` out before parsing, so committing an open block by
   * accident is not possible here: submit only ever happens on a closed line.
   */
  private async submit(): Promise<void> {
    const buffer = this.input();
    const lastLine = buffer.slice(buffer.lastIndexOf('\n') + 1);

    if (trailingBackslashes(lastLine) % 2 === 1) {
      this.input.set(`${buffer.slice(0, -1)}\n`);
      return;
    }

    this.input.set('');

    // Splice once, up front: the command that runs, the command remembered and the
    // command `history` prints are all the same one string, so they cannot drift.
    const command = spliceBlock(buffer);

    // Echo before running. A real terminal leaves the command line on screen with
    // its output under it, and bash has already recorded `history` by the time it
    // prints, so `history` lists itself last.
    this.recordBlock(buffer);
    this.rememberCommand(command);

    // An empty line runs nothing: bash prints no reply and leaves $? untouched,
    // so this must return before the not-found path can claim the blank as a
    // missing command named "".
    if (command.trim() === '') return;

    const resolution = resolveCommand(command);

    if (resolution.found) {
      /*
        Status 0 unless the command says otherwise. A promise is awaited first,
        because a command that finishes its work later must not have its success
        recorded before that work is known: `font --save` that the browser refused
        has to be followed by `✗`, not by the `❯` the call itself earned.
      */
      const outcome = resolution.command.run(this, resolution.args);
      if (outcome instanceof Promise) this.lastStatus.set((await outcome) ?? 0);
      else this.lastStatus.set(outcome ?? 0);
      return;
    }

    this.printOutput([commandNotFound(this.config.shell, resolution.name)]);
    this.lastStatus.set(EXIT_NOT_FOUND);
  }

  /** Echo a finished block on screen, one entry per physical line. Not persisted. */
  private recordBlock(buffer: string): void {
    /*
      Read the status *now*, before anything runs: this is the glyph the prompt
      was actually showing while the line was being typed. By the time submit
      resolves the command, lastStatus has already moved on.
    */
    const failed = this.failed();
    const lines: RenderLine[] = buffer.split('\n').map((text, index) => ({
      text,
      kind: index === 0 ? 'primary' : 'continuation',
      failed,
    }));
    this.scrollback.update((scrollback) => [...scrollback, ...lines]);
  }

  /** Add to the history bash-style: blank lines are not commands, so not kept. */
  private rememberCommand(command: string): void {
    if (command.trim() === '') return;
    this.commands.update((commands) => [...commands, command]);
    void this.store.append(command);
  }

  /**
   * The `clear` command. Public because TerminalCommandContext requires it.
   *
   * Clears the screen only: the command history and the persisted log are left
   * alone, which is what a real terminal does, since its history lives in a file
   * rather than in the scrollback.
   *
   * Re-pins to the bottom afterwards: the old last line is gone, and a stale false
   * here would leave a cleared terminal refusing to follow new input.
   */
  clearScreen(): void {
    this.scrollback.set([]);
    this.atBottom = true;
  }

  /** The remembered commands, oldest first. Survives `clear` and survives reload. */
  commandList(): readonly string[] {
    return this.commands();
  }

  /** Machine output: drawn without a prompt, on screen only. */
  printOutput(lines: readonly string[]): void {
    if (lines.length === 0) return;
    const output = lines.map((text) => ({ text, kind: 'output' as const }));
    this.scrollback.update((scrollback) => [...scrollback, ...output]);
  }

  /**
   * The `neofetch` block. Public because TerminalCommandContext requires it.
   *
   * Uptime is stamped here, when the command runs, rather than read by the
   * component at paint time: a report is a snapshot, and scrolling back to it later
   * must not quietly restate how long the session has been open since.
   */
  showNeofetch(): void {
    const block: RenderLine = {
      text: '',
      kind: 'neofetch',
      uptimeMs: this.boot.uptimeMs(),
    };
    this.scrollback.update((scrollback) => [...scrollback, block]);
  }

  /** The selectable fonts. Config order, which is the order `--list` should show. */
  fontCatalogue(): readonly FontChoice[] {
    return FICTIONAL_TERMINAL.fonts;
  }

  currentFont(): FontChoice {
    return this.fontChoice();
  }

  savedFontId(): string | null {
    return this.savedFont();
  }

  /**
   * Select for this session.
   *
   * Returns false rather than throwing for an unknown id: the command has to say
   * "no such font" and leave the screen exactly as it was, which is also what makes
   * trying a font out safe - a wrong guess cannot half-apply a family.
   */
  selectFont(id: string): boolean {
    const choice = FICTIONAL_TERMINAL.fonts.find((candidate) => candidate.id === id);
    if (!choice) return false;
    this.fontChoice.set(choice);
    return true;
  }

  /**
   * Persist the choice on screen, reporting whether the browser accepted the write.
   *
   * `savedFont` only moves when the transaction completed. A refusal - private
   * mode, quota, a second tab holding the database - leaves the reported state
   * saying "session only", which is true, rather than "saved", which would not be.
   */
  async saveFont(): Promise<boolean> {
    const chosen = this.fontChoice().id;
    const stored = await this.settings.save(SettingsStore.FONT, chosen);
    if (stored) this.savedFont.set(chosen);
    return stored;
  }

  private settleCaret(): void {
    this.typing.set(true);
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(
      () => this.typing.set(false),
      this.config.cursor.steadyAfterKeyMs,
    );
  }
}
