import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, signal, viewChild } from '@angular/core';
import { RenderLine, trailingBackslashes } from './line';
import { FICTIONAL_TERMINAL, TerminalConfig } from './terminal.config';

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
 */
@Component({
  selector: 'app-terminal',
  templateUrl: './terminal.html',
  styleUrl: './terminal.scss',
})
export class Terminal {
  protected readonly config: TerminalConfig = FICTIONAL_TERMINAL;

  /** Committed lines, oldest first. Empty entries are kept: a real shell shows a fresh prompt. */
  protected readonly history = signal<readonly RenderLine[]>([]);
  /** What is currently typed after the prompt; may span several lines. */
  protected readonly input = signal('');

  /** Solid rather than blinking for a moment after each keystroke. */
  protected readonly typing = signal(false);
  private typingTimer: ReturnType<typeof setTimeout> | undefined;

  /** Whether the view is parked at the bottom, which decides if we auto-follow. */
  private atBottom = true;

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly capture = viewChild<ElementRef<HTMLInputElement>>('capture');

  /*
    Trailing space is part of the prompt, not markup: Angular strips whitespace
    between inline elements, so `</span> <span>` would not survive compilation
    and the prompt would butt straight into the text ("❯ls"). whitespace-pre-wrap
    on the line preserves it here.
  */
  protected readonly prompt = computed(
    () => `${this.config.user}@${this.config.host} ${this.config.cwd} ${this.config.promptSymbol} `,
  );

  /** PS2, shown on every continuation line. */
  protected readonly continuationPrompt = computed(() => `${this.config.continuationSymbol} `);

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
      this.history();
      this.input();
      const el = this.scroller()?.nativeElement;
      // Only follow the output if the user is already parked at the bottom, so
      // scrolling back through history is not yanked away by the next line.
      if (el && this.atBottom) el.scrollTop = el.scrollHeight;
    });
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

    this.commitBlock(buffer);
  }

  /** Store every physical line, tagged with the prompt it was typed at. */
  private commitBlock(buffer: string): void {
    const lines: RenderLine[] = buffer.split('\n').map((text, index) => ({
      text,
      kind: index === 0 ? 'primary' : 'continuation',
    }));
    this.history.update((history) => [...history, ...lines]);
    this.input.set('');
  }

  private settleCaret(): void {
    this.typing.set(true);
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.typing.set(false), this.config.cursor.steadyAfterKeyMs);
  }
}
