import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Terminal } from './terminal';
import { BOOT_TIMING, TerminalBoot } from './boot';
import { FICTIONAL_TERMINAL } from './terminal.config';

describe('Terminal', () => {
  let component: Terminal;
  let fixture: ComponentFixture<Terminal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Terminal],
      // Long enough to assert against, short enough not to slow the suite.
      // The backstop is effectively off here so reveal depends on the dwell.
      providers: [{ provide: BOOT_TIMING, useValue: { minimumMs: 250, timeoutMs: 60_000 } }],
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
    /*
      The prefix comes from the config rather than being written out, because the
      name the shell reports itself as is a decision, not a fact: it is currently
      `fake-bash`, and pinning the string here would make renaming it mean editing
      tests. What these assert is the shape of the reply, which is what bash's
      behaviour actually constrains.
    */
    const notFound = (name: string): string =>
      `${FICTIONAL_TERMINAL.shell}: ${name}: command not found`;

    it('replies with the shell prefix and the conventional wording', () => {
      run('frobnicate');
      expect(outputs()).toContain(notFound('frobnicate'));
    });

    it('names only the command word, not the whole line', () => {
      run('git commit -m "message"');
      expect(outputs()).toContain(notFound('git'));
    });

    it('treats a near-miss as unknown rather than prefix matching', () => {
      run('clearx');
      expect(outputs()).toContain(notFound('clearx'));
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

  describe('neofetch', () => {
    const block = (): HTMLElement | null =>
      (fixture.nativeElement as HTMLElement).querySelector('app-neofetch');

    /** The report row for a label, read the way the template lays it out. */
    const reportValue = (label: string): string | undefined =>
      Array.from(block()?.querySelectorAll('.row') ?? [])
        .find((row) => row.querySelector('dt')?.textContent?.trim() === label)
        ?.querySelector('dd')
        ?.textContent?.trim();

    it('places the block directly under the echoed command', () => {
      run('neofetch');

      const echoed = paragraphs().find((p) => p.textContent?.includes('neofetch'));
      expect(echoed).toBeTruthy();
      // A block, not text: the next thing after the echoed line is the component,
      // not an output paragraph.
      expect(echoed?.nextElementSibling?.tagName).toBe('APP-NEOFETCH');
      expect(block()).toBeTruthy();
    });

    it('counts itself in the command total', () => {
      run('help');
      run('neofetch');
      // `history` records before running, so by the time the report is drawn the
      // command that asked for it is already in the list.
      expect(reportValue('Commands')).toBe('2');
    });

    it('is erased by clear, like any other screen output', () => {
      run('neofetch');
      expect(block()).toBeTruthy();

      run('clear');
      expect(block()).toBeNull();
      // The history is separate and survives, which is the same rule `clear`
      // follows for printed lines.
      run('history');
      expect(outputs()).toContain('1  neofetch');
    });
  });

  describe('motd', () => {
    const boot = (): TerminalBoot => TestBed.inject(TerminalBoot);
    const blocks = (): HTMLElement[] =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('app-neofetch'));

    /** Settle every source and wait out the dwell, the way a real load does. */
    async function reveal(): Promise<void> {
      boot().mark('identity');
      boot().mark('history');
      boot().mark('theme');
      await new Promise((resolve) => setTimeout(resolve, 400));
      fixture.detectChanges();
    }

    it('prints the report at the reveal, above the live prompt', async () => {
      expect(blocks()).toHaveLength(0);

      await reveal();

      expect(blocks()).toHaveLength(1);
      // The live prompt is the next element, so the greeting sits above what the
      // visitor is about to type rather than being pushed under it.
      const next = blocks()[0].nextElementSibling;
      expect(next?.tagName).toBe('P');
      expect(next?.textContent).toContain('@mpdev');
    });

    it('prints it once and only once, however much is typed afterwards', async () => {
      await reveal();
      expect(blocks()).toHaveLength(1);

      run('help');
      // Still one: the effect fires on the reveal, not on every scrollback edit.
      expect(blocks()).toHaveLength(1);

      run('clear');
      // `clear` erases the screen and the greeting stays erased; it is not re-printed
      // into the blank screen the way a real shell's MOTD would not be either.
      expect(blocks()).toHaveLength(0);
      run('help');
      expect(blocks()).toHaveLength(0);
    });

    it('stays out of the way when the visitor already ran a command', async () => {
      run('help');
      expect(blocks()).toHaveLength(0);

      await reveal();
      // A report printed under the visitor's own output would read as that
      // command's output, so the greeting yields to anything already on screen.
      expect(blocks()).toHaveLength(0);
    });
  });

  describe('boot', () => {
    const identityVisible = (): boolean =>
      (fixture.nativeElement as HTMLElement).textContent?.includes('@mpdev') ?? false;
    const bootText = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
    const boot = (): TerminalBoot => TestBed.inject(TerminalBoot);

    /** The boot line, while the dwell is running. */
    const BAR = /booting \d+%/;

    async function waited(ms: number): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, ms));
      fixture.detectChanges();
    }

    it('shows the name only once the identity source has actually answered', async () => {
      /*
        Asserting "absent at time X" would depend on whether jsdom's storage stub
        resolved before this line ran, so the test states the rule instead: the
        name is on screen if and only if that one source has settled. Then it waits
        for the settle and checks the name really does arrive.
      */
      fixture.detectChanges();
      expect(identityVisible()).toBe(boot().has('identity'));

      // Bounded so a regression fails the test instead of hanging the suite.
      for (let i = 0; i < 50 && !boot().has('identity'); i++) await waited(10);
      expect(boot().has('identity')).toBe(true);
      expect(identityVisible()).toBe(true);
    });

    it('puts a determinate boot bar over the prompt from the first frame', () => {
      // showLoader is true before the dwell elapses, with no timing to win.
      fixture.detectChanges();
      expect(boot().showLoader()).toBe(true);
      expect(bootText()).toMatch(BAR);
    });

    it('lifts the bar once the dwell passes and every source has settled', async () => {
      boot().mark('identity');
      boot().mark('history');
      boot().mark('theme');

      // Still up: readiness alone is not enough, which is the whole point of the dwell.
      expect(boot().showLoader()).toBe(true);

      await waited(400);
      expect(boot().showLoader()).toBe(false);
      expect(bootText()).not.toMatch(BAR);
    });

    it('keeps the bar up when a source never answers, until the backstop', async () => {
      // `theme` belongs to MainContainer and is never marked in this fixture.
      boot().mark('identity');
      boot().mark('history');
      await waited(400);
      expect(boot().ready()).toBe(false);
      expect(bootText()).toMatch(BAR);
    });

    it('lets typed input take over from the hint', async () => {
      expect(bootText()).toMatch(BAR);
      type('ls');
      expect(bootText()).not.toMatch(BAR);
    });
  });
});
