import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommandStore } from './command.store';
import {
  commandNotFound,
  EXIT_NOT_FOUND,
  resolveCommand,
  TerminalCommandContext,
} from './commands';
import { SettingsStore } from './settings.store';
import { LineKind, RenderLine, spliceBlock, trailingBackslashes } from './line';
import { buildContinuation, buildPrompt, PromptSegment } from './prompt';
import { FICTIONAL_TERMINAL, TerminalConfig } from './terminal.config';
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
})
export class Terminal implements TerminalCommandContext {
  protected readonly config: TerminalConfig = FICTIONAL_TERMINAL;

  /** Lines on screen, oldest first. Empty entries are kept: a shell still shows a prompt. */
  protected readonly scrollback = signal<readonly RenderLine[]>([]);
  /** The persisted command history, oldest first. */
  private readonly commands = signal<readonly string[]>([]);
  /** What is currently typed after the prompt; may span several lines. */
  protected readonly input = signal('');

  /** Solid rather than blinking for a moment after each keystroke. */
  protected readonly typing = signal(false);
  private typingTimer: ReturnType<typeof setTimeout> | undefined;

  /** Whether the view is parked at the bottom, which decides if we auto-follow. */
  private atBottom = true;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly capture = viewChild<ElementRef<HTMLInputElement>>('capture');
  private readonly settings = inject(SettingsStore);

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

  protected readonly promptSegments = computed(() =>
    buildPrompt({
      user: this.user(),
      host: this.config.host,
      cwd: this.config.cwd,
      symbol: this.config.promptSymbol,
      errorSymbol: this.config.errorSymbol,
      failed: this.failed(),
      showIdentity: this.config.showUserHost,
    }),
  );

  /** PS2 for continuation lines. */
  protected readonly continuationSegments = computed(() =>
    buildContinuation(this.config.continuationSymbol),
  );

  /**
   * Segments for a committed line. Output lines get a shared empty array rather
   * than being special-cased in the template, and every branch returns a stable
   * reference so the inner loop does not re-render on unrelated change detection.
   */
  protected segmentsFor(kind: LineKind): readonly PromptSegment[] {
    if (kind === 'primary') return this.promptSegments();
    if (kind === 'continuation') return this.continuationSegments();
    return NO_SEGMENTS;
  }

  /** The line being typed: PS1 on its first line, PS2 on any that follow. */
  protected liveSegments(isFirst: boolean): readonly PromptSegment[] {
    return isFirst ? this.promptSegments() : this.continuationSegments();
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

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    destroyRef: DestroyRef,
  ) {
    destroyRef.onDestroy(() => clearTimeout(this.typingTimer));

    // Publish the config as the custom properties the Tailwind utilities read.
    // --animate-caret is written as the whole shorthand on purpose: a nested
    // var() in the token would be substituted at :root and could not be retuned
    // from here.
    effect(() => {
      const { font, cursor } = this.config;
      const style = this.host.nativeElement.style;
      style.setProperty('--font-terminal', font.family);
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

    // Both reads can land after the view is gone, so guard the writes.
    let alive = true;
    destroyRef.onDestroy(() => {
      alive = false;
    });
    if (!this.config.user) {
      void this.settings.guestName().then((name) => {
        if (alive) this.guest.set(name);
      });
    }
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
        this.submit();
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
      this.submit();
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
  private submit(): void {
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
      // Nothing here can fail yet, so a completed command is status 0. When a
      // real exec lands, it should set whatever the child exited with instead.
      resolution.command.run(this, resolution.args);
      this.lastStatus.set(0);
      return;
    }

    this.printOutput([commandNotFound(this.config.shell, resolution.name)]);
    this.lastStatus.set(EXIT_NOT_FOUND);
  }

  /** Echo a finished block on screen, one entry per physical line. Not persisted. */
  private recordBlock(buffer: string): void {
    const lines: RenderLine[] = buffer.split('\n').map((text, index) => ({
      text,
      kind: index === 0 ? 'primary' : 'continuation',
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

  private settleCaret(): void {
    this.typing.set(true);
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(
      () => this.typing.set(false),
      this.config.cursor.steadyAfterKeyMs,
    );
  }
}
