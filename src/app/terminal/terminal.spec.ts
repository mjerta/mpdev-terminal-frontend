import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { HOLD_TIMING, Terminal } from './terminal';
import { BOOT_TIMING, TerminalBoot } from './boot';
import { REVEAL_TIMING } from './neofetch/neofetch';
import { FICTIONAL_TERMINAL } from './terminal.config';

describe('Terminal', () => {
  let component: Terminal;
  let fixture: ComponentFixture<Terminal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Terminal],
      // Long enough to assert against, short enough not to slow the suite.
      // The backstop is effectively off here so reveal depends on the dwell.
      providers: [
        { provide: BOOT_TIMING, useValue: { minimumMs: 250, timeoutMs: 60_000 } },
        // The report types itself in; a word a millisecond keeps that from being
        // the slowest thing in the suite.
        { provide: REVEAL_TIMING, useValue: { msPerToken: 1 } },
        // A two-second hold per test would be the slowest thing in the suite.
        { provide: HOLD_TIMING, useValue: { ms: 5, slopPx: 12, idleMs: 50 } },
      ],
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

  /*
    Shared by the neofetch and font blocks: a report's rows are read the same way
    whichever command printed it, and `font` has to prove it reaches the report.
  */
  const block = (): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector('app-neofetch');

  /** The report row for a label, read the way the template lays it out. */
  function reportValue(label: string): string | undefined {
    return (
      Array.from(block()?.querySelectorAll('.row') ?? [])
        // The colon is markup, not `dt::after`, so it is part of the label's text.
        .find((row) => row.querySelector('dt')?.textContent?.trim() === `${label}:`)
        ?.querySelector('dd')
        ?.textContent?.trim()
    );
  }

  /** Wait for the report to finish arriving; it types itself in word by word. */
  async function revealed(): Promise<void> {
    const report = (): Element | null | undefined => block()?.querySelector('.neofetch');
    for (let i = 0; i < 200 && report()?.getAttribute('aria-busy') === 'true'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      fixture.detectChanges();
    }
    fixture.detectChanges();
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

  describe('font', () => {
    /** The published custom property the terminal's text metrics come from. */
    const publishedFamily = (): string =>
      (fixture.nativeElement as HTMLElement).style.getPropertyValue('--font-terminal');

    /** The separate property the logo is pinned to, which must never move. */
    const publishedLogoFamily = (): string =>
      (fixture.nativeElement as HTMLElement).style.getPropertyValue('--font-logo');

    /** Let a command's promise settle; `--save` is the only asynchronous one. */
    async function settled(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      fixture.detectChanges();
    }

    it('publishes the chosen family onto the terminal', () => {
      run('font mono');
      expect(publishedFamily()).toContain('monospace');

      run('font nerd');
      expect(publishedFamily()).toContain('JetBrainsMono Nerd Font');
    });

    it('keeps the logo on the bundled face whatever the text is drawn in', () => {
      /*
        The regression this guards: the art used to inherit the chosen family, and a
        device face that substitutes the box-drawing range per glyph puts those cells
        on a different pitch than its own spaces. The logo is a grid, so its spaces
        shift every column to the right and the block letters lean - reported from a
        phone, reproduced here by measuring a lone `ui-monospace`: 0.60em for the
        space, 0.71em for the blocks.

        So two properties are published, and only one of them is a choice.
      */
      const logoBefore = publishedLogoFamily();
      expect(logoBefore).toContain('JetBrainsMono Nerd Font');

      run('font mono');
      expect(publishedFamily()).toContain('monospace');
      expect(publishedLogoFamily()).toBe(logoBefore);

      run('font system');
      expect(publishedFamily()).toContain('ui-monospace');
      expect(publishedLogoFamily()).toBe(logoBefore);

      // Every bundled Nerd Font is a different face, but still not the logo's.
      // Derived from the catalogue so a new entry is covered without editing this.
      for (const choice of FICTIONAL_TERMINAL.fonts) {
        if (choice.id === 'system' || choice.id === 'mono') continue;
        const [family = ''] = choice.family.split(',');
        const drawn = family.trim().replace(/^['"]|['"]$/g, '');

        run(`font ${choice.id}`);
        expect(publishedFamily()).toContain(drawn);
        expect(publishedLogoFamily()).toBe(logoBefore);
      }
    });

    it('lists what is available without changing anything', () => {
      const before = publishedFamily();
      run('font --list');

      expect(outputs().join('\n')).toContain('JetBrains Mono');
      expect(publishedFamily()).toBe(before);
    });

    it('leaves the choice alone and fails when the name is not one it has', () => {
      const before = publishedFamily();
      run('font comic-sans');

      expect(publishedFamily()).toBe(before);
      // The failure is a usage error, so the very next prompt carries `✗`.
      expect(liveGlyph()).toBe('✗');
      expect(outputs().join('\n')).toContain('unknown font');
    });

    it('reports the saved state honestly when there is nowhere to save', async () => {
      /*
        jsdom has no IndexedDB, which makes this the private-mode case: the write
        is refused. The command still applied the font - that part did happen - but
        it must not claim the choice will outlive the session, and it must not be
        followed by a success glyph.
      */
      run('font --save mono');
      await settled();

      expect(publishedFamily()).toContain('monospace');
      expect(outputs().join('\n')).toContain('could not save');
      expect(liveGlyph()).toBe('✗');
    });

    it('prints the font in force at the moment the report was made', async () => {
      run('font mono');
      run('neofetch');
      await revealed();

      expect(reportValue('Font')).toBe('monospace');
    });
  });

  describe('neofetch', () => {
    it('places the block directly under the echoed command', () => {
      run('neofetch');

      const echoed = paragraphs().find((p) => p.textContent?.includes('neofetch'));
      expect(echoed).toBeTruthy();
      // A block, not text: the next thing after the echoed line is the component,
      // not an output paragraph.
      expect(echoed?.nextElementSibling?.tagName).toBe('APP-NEOFETCH');
      expect(block()).toBeTruthy();
    });

    it('counts itself in the command total', async () => {
      run('help');
      run('neofetch');
      await revealed();
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

  describe('history recall', () => {
    function pressArrow(key: 'ArrowUp' | 'ArrowDown'): void {
      fixture.debugElement.query(By.css('input.capture')).triggerEventHandler('keydown', {
        key,
        shiftKey: false,
        isComposing: false,
        preventDefault: () => {},
      });
      fixture.detectChanges();
    }

    /** The text on the live line: the prompt row minus its glyph. */
    function liveText(): string {
      return (promptRows().at(-1) ?? '').replace(/^\S+\s*/, '');
    }

    function nav(): HTMLElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('.history-nav');
    }

    function navButton(index: number): void {
      fixture.debugElement
        .queryAll(By.css('.history-nav button'))
        [index].triggerEventHandler('click', {});
      fixture.detectChanges();
    }

    /** Press and hold on the scroller, then let the (test-shrunk) timer fire. */
    async function hold(): Promise<void> {
      fixture.debugElement.query(By.css('.scroller')).triggerEventHandler('pointerdown', {
        pointerType: 'touch',
        button: 0,
        clientX: 100,
        clientY: 200,
        preventDefault: () => {},
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      fixture.detectChanges();
    }

    it('walks the history with the arrow keys, newest first', () => {
      run('help');
      run('history');

      pressArrow('ArrowUp');
      expect(liveText()).toBe('history');
      pressArrow('ArrowUp');
      expect(liveText()).toBe('help');
      // The oldest entry sticks: ↑ at the top does not wrap.
      pressArrow('ArrowUp');
      expect(liveText()).toBe('help');
      pressArrow('ArrowDown');
      expect(liveText()).toBe('history');
      // Past the newest is your own empty line again.
      pressArrow('ArrowDown');
      expect(liveText()).toBe('');
    });

    it('gives back the half-typed line when you come back down', () => {
      run('history');
      type('neof');

      pressArrow('ArrowUp');
      expect(liveText()).toBe('history');
      pressArrow('ArrowDown');
      expect(liveText()).toBe('neof');
    });

    it('treats typing over a recalled line as a new walk', () => {
      run('one');
      run('two');

      pressArrow('ArrowUp');
      expect(liveText()).toBe('two');
      type('x');
      expect(liveText()).toBe('twox');
      // The walk ended at the edit, so ↑ starts over from the newest command.
      pressArrow('ArrowUp');
      expect(liveText()).toBe('two');
    });

    it('reveals the arrows on a held press and drives the same recall', async () => {
      run('help');

      await hold();
      expect(nav()).toBeTruthy();

      navButton(0); // ↑
      expect(liveText()).toBe('help');
      navButton(1); // ↓
      expect(liveText()).toBe('');
    });

    it('reveals nothing when there is no history to walk', async () => {
      await hold();
      expect(nav()).toBeNull();
    });

    it('reads a wandering finger as a scroll, not a hold', async () => {
      const scroller = fixture.debugElement.query(By.css('.scroller'));
      scroller.triggerEventHandler('pointerdown', {
        pointerType: 'touch',
        button: 0,
        clientX: 100,
        clientY: 200,
        preventDefault: () => {},
      });
      scroller.triggerEventHandler('pointermove', {
        pointerType: 'touch',
        clientX: 100,
        clientY: 260,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      fixture.detectChanges();
      expect(nav()).toBeNull();
    });

    it('retires the arrows after a few idle seconds', async () => {
      run('help');
      await hold();
      expect(nav()).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 90));
      fixture.detectChanges();
      expect(nav()).toBeNull();
    });

    it('puts the arrows away as soon as you type', async () => {
      run('help');
      await hold();
      expect(nav()).toBeTruthy();

      type('x');
      expect(nav()).toBeNull();
    });
  });
});
