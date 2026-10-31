import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, inject, signal, viewChild } from '@angular/core';
import { CommandStore } from './command.store';
import { findCommand, TerminalCommandContext } from './commands';
import { LineKind, RenderLine, spliceBlock, trailingBackslashes } from './line';
import { FICTIONAL_TERMINAL, TerminalConfig } from './terminal.config';
import { ClientIdentity, describeClient, readClientHints } from './platform';

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
  private readonly store = inject(CommandStore);

  /*
    The machine name, resolved from the least-lying signal available. A browser
    cannot read a hostname, so this is a device model where Chromium will give one
    (`navigator.userAgentData.getHighEntropyValues(['model'])` really returns
    "Pixel 7" on a Pixel) and a platform class everywhere else. `config.host`
    overrides it outright, which is where a backend reporting os.hostname()
    belongs. Resolved asynchronously, so it starts undefined-ish and fills in.
  */
  private readonly client = signal<ClientIdentity>({ label: 'unknown', source: 'unknown' });

  protected readonly hostName = computed(() => this.config.host ?? this.client().label);

  /*
    Trailing space is part of the prompt, not markup: Angular strips whitespace
    between inline elements, so `</span> <span>` would not survive compilation
    and the prompt would butt straight into the text ("❯ls"). whitespace-pre-wrap
    on the line preserves it here.
  */
  protected readonly prompt = computed(
    () => `${this.config.user}@${this.hostName()} ${this.config.cwd} ${this.config.promptSymbol} `,
  );

  /** PS2, shown on every continuation line. */
  protected readonly continuationPrompt = computed(() => `${this.config.continuationSymbol} `);

  /**
   * The prompt a line is drawn with. Output lines get an empty string rather than
   * being skipped, so their text still starts at column 0 while the markup stays
   * uniform across the loop.
   */
  protected promptFor(kind: LineKind): string {
    if (kind === 'primary') return this.prompt();
    if (kind === 'continuation') return this.continuationPrompt();
    return '';
  }

  /**
   * Shown as a tooltip on the prompt. The label for an Android phone really is
   * its model, while `linux` is a UA-string guess, so the provenance is worth
   * exposing rather than presenting every tier as the same quality of fact.
   */
  protected readonly hostSource = computed(() => {
    if (this.config.host) return 'pinned by config';
    switch (this.client().source) {
      case 'model':
        return 'device model (UA-CH)';
      case 'platform':
        return 'platform hint (UA-CH)';
      case 'user-agent':
        return 'guessed from the user-agent string';
      default:
        return 'not reported by this browser';
    }
  });

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
    afterRenderEffect(() => {
      this.scrollback();
      this.input();
      const el = this.scroller()?.nativeElement;
      // Only follow the output if the user is already parked at the bottom, so
      // scrolling back through the log is not yanked away by the next line.
      if (el && this.atBottom) el.scrollTop = el.scrollHeight;
    });

    void this.restore();

    // The machine name arrives asynchronously: UA-CH high-entropy values are a
    // promise by spec, and may resolve after the view is gone.
    let alive = true;
    destroyRef.onDestroy(() => {
      alive = false;
    });
    void readClientHints().then((hints) => {
      if (alive) this.client.set(describeClient(hints));
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

    const invocation = findCommand(command);
    if (invocation) {
      invocation.command.run(this, invocation.args);
    }
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
    this.typingTimer = setTimeout(() => this.typing.set(false), this.config.cursor.steadyAfterKeyMs);
  }
}
