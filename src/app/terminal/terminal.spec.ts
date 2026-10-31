import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Terminal } from './terminal';

describe('Terminal', () => {
  let component: Terminal;
  let fixture: ComponentFixture<Terminal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Terminal],
    }).compileComponents();

    fixture = TestBed.createComponent(Terminal);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    // The caret timer is a real macrotask; releasing the view clears it.
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * Drives the component through the same bindings the template uses, so these
   * tests exercise the real submit/record/resolve path rather than reaching into
   * private members. Payloads are plain objects: jsdom has no usable InputEvent
   * constructor, and triggerEventHandler calls the listener directly anyway.
   */
  function type(text: string): void {
    const input = fixture.debugElement.query(By.css('input.capture'));
    for (const ch of text) {
      input.triggerEventHandler('beforeinput', {
        inputType: 'insertText',
        data: ch,
        preventDefault: () => {},
      });
    }
    fixture.detectChanges();
  }

  function pressEnter(): void {
    fixture.debugElement.query(By.css('input.capture')).triggerEventHandler('keydown', {
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      preventDefault: () => {},
    });
    fixture.detectChanges();
  }

  const run = (command: string): void => {
    type(command);
    pressEnter();
  };

  /** `"glyph command"` for every prompt line, committed lines only. */
  function committedPrompts(): string[] {
    const rows = promptRows();
    return rows.slice(0, -1);
  }

  /** The live prompt's glyph, i.e. the status of the command that just ran. */
  function liveGlyph(): string {
    return promptRows().at(-1)?.split(' ')[0] ?? '';
  }

  /**
   * Every rendered line, in screen order. Queried as plain `p` rather than
   * `main p`: the <main> element belongs to MainContainer, so it does not exist
   * in this component's own fixture.
   */
  function paragraphs(): HTMLParagraphElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('p'));
  }

  /** `"glyph command"` for each prompt line. The live line is always last. */
  function promptRows(): string[] {
    return paragraphs()
      .filter((p) => p.querySelector('span.text-ansi-cyan'))
      .map((p) => {
        const emphasis = Array.from(p.querySelectorAll('span.text-ansi-cyan'));
        // The typed text is the only class-less span in a prompt paragraph.
        const typed = Array.from(p.querySelectorAll('span:not([class])'));
        const glyph = emphasis.at(-1)?.textContent?.trim() ?? '';
        return `${glyph} ${typed.at(-1)?.textContent?.trim() ?? ''}`.trimEnd();
      });
  }

  /** Machine output: paragraphs with no prompt segments at all. */
  function outputs(): string[] {
    return paragraphs()
      .filter((p) => !p.querySelector('span.text-ansi-cyan'))
      .map((p) => p.textContent?.trim() ?? '')
      .filter((text) => text !== '');
  }

  describe('the error glyph', () => {
    /*
      This is the regression guard. The failure this catches: one computed read the
      live exit status and every committed prompt rendered from it, so a single
      failed command flipped every `❯` above it into `✗`. An earlier round of
      verification missed it entirely because it only ever sampled the live line.
    */
    it('stays on the line that earned it instead of repainting history', () => {
      run('help');
      expect(committedPrompts()).toEqual(['❯ help']);

      run('nope');
      // The line was echoed while help's success still stood, so it keeps ❯ even
      // though the command itself just failed.
      expect(committedPrompts()).toEqual(['❯ help', '❯ nope']);
      expect(liveGlyph()).toBe('✗');

      run('help');
      // The earlier `❯ help` must survive the intervening failure untouched.
      expect(committedPrompts()).toEqual(['❯ help', '❯ nope', '✗ help']);
      expect(liveGlyph()).toBe('❯');
    });

    it('does not rewrite anything above a later failure', () => {
      run('help');
      run('help');
      const before = committedPrompts();

      run('nope');
      expect(committedPrompts().slice(0, before.length)).toEqual(before);
      expect(liveGlyph()).toBe('✗');
    });

    it('restores the success glyph after the next working command', () => {
      run('nope');
      expect(liveGlyph()).toBe('✗');
      run('help');
      expect(liveGlyph()).toBe('❯');
    });
  });

  describe('unknown commands', () => {
    it('replies the way bash words it', () => {
      run('frobnicate');
      expect(outputs()).toContain('bash: frobnicate: command not found');
    });

    it('names only the command word, not the whole line', () => {
      run('git commit -m "message"');
      expect(outputs()).toContain('bash: git: command not found');
    });

    it('treats a near-miss as unknown rather than prefix matching', () => {
      run('clearx');
      expect(outputs()).toContain('bash: clearx: command not found');
    });
  });

  describe('an empty line', () => {
    it('prints no reply and leaves the status alone, like bash', () => {
      run('nope');
      const repliesBefore = outputs().length;
      expect(liveGlyph()).toBe('✗');

      pressEnter();

      expect(outputs().length).toBe(repliesBefore);
      expect(liveGlyph()).toBe('✗');
    });
  });

  describe('clear', () => {
    it('erases the screen without erasing the history', () => {
      run('help');
      run('nope');
      run('clear');
      // Nothing but the live prompt is left on screen.
      expect(committedPrompts()).toEqual([]);
      expect(outputs()).toEqual([]);

      run('history');
      const listed = outputs().join('\n');
      expect(listed).toContain('help');
      expect(listed).toContain('nope');
      expect(listed).toContain('clear');
    });
  });
});
