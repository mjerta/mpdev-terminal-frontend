import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  formatUptime,
  Neofetch,
  REDUCED_MOTION,
  revealAt,
  REVEAL_TIMING,
  streamWords,
} from './neofetch';
import { FICTIONAL_TERMINAL } from '../terminal.config';

/** 1ms per word: the whole report lands in well under a frame budget of waiting. */
const FAST = { msPerToken: 1 };

/** The finished report, so the tests can state what a prefix must grow into. */
const FULL_ROWS = 10;

describe('streamWords', () => {
  const details = [
    { label: 'OS', value: 'mpdev web terminal' },
    { label: 'Commands', value: '7' },
  ];

  it('types the identity before the first label', () => {
    const words = streamWords('guest-x32a', 'mpdev', details);

    expect(words[0]).toEqual({ slot: 'user', row: -1, text: 'guest-x32a' });
    expect(words[1]).toEqual({ slot: 'host', row: -1, text: 'mpdev' });
    expect(words[2].slot).toBe('label');
    expect(words[2].row).toBe(0);
  });

  it('splits a value into its words, and no further', () => {
    const words = streamWords('guest', 'mpdev', details);
    const firstRow = words.filter((word) => word.row === 0).map((word) => word.text);

    // label, then the three words of the value: the row arrives over four ticks.
    expect(firstRow).toEqual(['OS', 'mpdev', 'web', 'terminal']);
  });

  it('keeps every row addressed by its own index', () => {
    const words = streamWords('guest', 'mpdev', details);

    expect(new Set(words.map((word) => word.row))).toEqual(new Set([-1, 0, 1]));
    expect(words.filter((word) => word.slot === 'label')).toHaveLength(details.length);
  });
});

describe('revealAt', () => {
  const words = streamWords('guest-9', 'mpdev', [
    { label: 'OS', value: 'mpdev web terminal' },
    { label: 'Uptime', value: '12s' },
  ]);

  it('shows nothing before the first word lands', () => {
    const reveal = revealAt(words, 0);

    expect(reveal.user).toBe('');
    expect(reveal.rows).toEqual([]);
    expect(reveal.caretRow).toBeNull();
    expect(reveal.done).toBe(false);
  });

  it('grows a value word by word, in the row order', () => {
    // Identity is two words, then `OS` and its three: 3 + 1 + 3 before `Uptime`.
    expect(revealAt(words, 3).rows).toEqual([{ label: 'OS', value: '' }]);
    expect(revealAt(words, 4).rows).toEqual([{ label: 'OS', value: 'mpdev' }]);
    expect(revealAt(words, 5).rows).toEqual([{ label: 'OS', value: 'mpdev web' }]);
    expect(revealAt(words, 6).rows).toEqual([{ label: 'OS', value: 'mpdev web terminal' }]);
    // The second row's label has not landed, so the row does not exist yet.
    expect(revealAt(words, 6).rows).toHaveLength(1);
    expect(revealAt(words, 7).rows).toEqual([
      { label: 'OS', value: 'mpdev web terminal' },
      { label: 'Uptime', value: '' },
    ]);
  });

  it('always holds a prefix of the finished report', () => {
    const full = revealAt(words, words.length);

    for (let emitted = 0; emitted <= words.length; emitted++) {
      const reveal = revealAt(words, emitted);
      const typed = [
        reveal.user,
        reveal.host,
        ...reveal.rows.flatMap((row) => [row.label, row.value]),
      ]
        .filter((part) => part !== '')
        .join(' ');
      const finished = [full.user, full.host, ...full.rows.flatMap((row) => [row.label, row.value])]
        .filter((part) => part !== '')
        .join(' ');

      // The promise the effect rests on: nothing is rewritten or reordered.
      expect(finished.startsWith(typed)).toBe(true);
    }
  });

  it('moves the cursor to the row being typed, then retires it', () => {
    // -1 is the identity line, which is where the first two words land.
    expect(revealAt(words, 1).caretRow).toBe(-1);
    expect(revealAt(words, 3).caretRow).toBe(0);
    expect(revealAt(words, 7).caretRow).toBe(1);
    // A cursor outliving the stream reads as a prompt waiting for input.
    expect(revealAt(words, words.length).caretRow).toBeNull();
  });

  it('clamps counts that are not in range rather than inventing text', () => {
    // jsdom timers and a re-entrant tick can both ask for out-of-range values.
    expect(revealAt(words, -5)).toEqual(revealAt(words, 0));
    expect(revealAt(words, 999)).toEqual(revealAt(words, words.length));
    expect(revealAt(words, 999).done).toBe(true);
  });
});

describe('Neofetch', () => {
  let fixture: ComponentFixture<Neofetch>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => root().textContent ?? '';
  const rows = (): HTMLElement[] => Array.from(root().querySelectorAll('.row'));
  const valueFor = (label: string): string | undefined =>
    rows()
      .find(
        (row) => row.querySelector('dt')?.textContent?.replace(/\s+/g, ' ').trim() === `${label}:`,
      )
      ?.querySelector('dd')
      ?.textContent?.trim();

  /** Inputs have to be set before the first change detection: the report is a snapshot. */
  function render(
    inputs: Record<string, unknown> = {},
    timing: { msPerToken: number } = FAST,
    reducedMotion = false,
  ): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Neofetch],
      providers: [
        { provide: REVEAL_TIMING, useValue: timing },
        { provide: REDUCED_MOTION, useValue: reducedMotion },
      ],
    });
    fixture = TestBed.createComponent(Neofetch);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  /**
   * Let the typing finish.
   *
   * Waits on "no longer busy" rather than on a row count: a row exists from the
   * moment its label lands, which is a word before its value has, so counting rows
   * would let this return while the last line was still being typed.
   */
  async function typed(): Promise<void> {
    for (
      let i = 0;
      i < 500 && root().querySelector('.neofetch')?.getAttribute('aria-busy') === 'true';
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      fixture.detectChanges();
    }
  }

  afterEach(() => {
    fixture?.destroy();
  });

  it('prints the logo as a rectangular block', () => {
    /*
      Not cosmetic. The stylesheet sizes the art against the viewport from its
      column count, so a row that is short would leave the logo floating and a row
      that is long would be clipped on a phone. This is the invariant that makes
      the scaling maths valid.
    */
    render();
    const art = root().querySelector('pre')?.textContent ?? '';
    const lines = art.split('\n');

    expect(lines).toHaveLength(6);
    expect(new Set(lines.map((line) => [...line].length))).toEqual(new Set([48]));
    // Still the name, not just a rectangle: every letter has to be represented.
    expect(art).toContain('╚═╝');
  });

  it('hides the logo from assistive tech, which already hears the host name', () => {
    render();
    expect(root().querySelector('pre')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes the machine details from the config map', async () => {
    render();
    await typed();

    expect(valueFor('OS')).toBe(FICTIONAL_TERMINAL.system.os);
    expect(valueFor('Host')).toBe(FICTIONAL_TERMINAL.host);
    expect(valueFor('Kernel')).toBe(FICTIONAL_TERMINAL.system.kernel);
    expect(valueFor('Shell')).toBe(FICTIONAL_TERMINAL.shell);
    expect(valueFor('Terminal')).toBe(FICTIONAL_TERMINAL.system.terminal);
  });

  it('names the visitor exactly as the prompt does', async () => {
    render({ user: 'guest-x32a' });
    await typed();
    expect(text()).toContain('guest-x32a@mpdev');
  });

  it('reports the live values it was handed', async () => {
    render({ theme: 'dracula', uptimeMs: 125_000, commands: 7 });
    await typed();

    expect(valueFor('Theme')).toBe('dracula');
    expect(valueFor('Uptime')).toBe('2m 5s');
    expect(valueFor('Commands')).toBe('7');
  });

  it('names the chosen face, not its CSS declaration', async () => {
    render();
    await typed();
    // The full stack wraps to three lines on a phone, and even the canonical Nerd
    // Font family name overflows the committed width; the label is the name.
    expect(valueFor('Font')).toBe('JetBrains Mono');
  });

  it('prints the font it was handed rather than the default', async () => {
    const mono = FICTIONAL_TERMINAL.fonts.find((choice) => choice.id === 'mono')!;
    render({ font: mono });
    await typed();

    expect(valueFor('Font')).toBe('monospace');
  });

  it('freezes the font row too when the choice changes afterwards', async () => {
    /*
      A block printed under one font keeps naming that font. The report is a
      snapshot of what was printed, so a later choice must not rewrite its history -
      and because the art is pinned to the bundled face, the picture next to it does
      not follow the choice either. The row describes the text, which is what the
      choice actually governed.
    */
    const bundled = FICTIONAL_TERMINAL.fonts[0];
    render({ font: bundled });
    await typed();
    expect(valueFor('Font')).toBe('JetBrains Mono');

    fixture.componentRef.setInput(
      'font',
      FICTIONAL_TERMINAL.fonts.find((c) => c.id === 'mono')!,
    );
    fixture.detectChanges();
    expect(valueFor('Font')).toBe('JetBrains Mono');
  });

  it('falls back to the config ratio when there is nothing to measure', () => {
    /*
      The art is sized from the measured cell width of the face in use, and jsdom
      lays nothing out. The fallback has to be the default face's ratio rather than
      zero, because a ratio of 0 would divide the size to nothing.
    */
    render();
    const art = (fixture.nativeElement as HTMLElement).querySelector('pre') as HTMLElement;

    expect(art.style.getPropertyValue('--cell-ratio')).toBe(
      String(FICTIONAL_TERMINAL.font.advanceRatio),
    );
  });

  it('reports a real resolution rather than an empty one', async () => {
    render();
    await typed();
    expect(valueFor('Resolution')).toMatch(/^\d+x\d+$/);
    expect(valueFor('Resolution')).not.toBe('0x0');
  });

  it('freezes the report at the moment it was printed', async () => {
    /*
      A report is a snapshot. If a later `neofetch` runs, or the theme changes, an
      older block must keep saying what it said - otherwise scrolling back would
      show today's numbers under yesterday's logo.
    */
    render({ theme: 'nord', uptimeMs: 1_000, commands: 3 });
    await typed();
    expect(valueFor('Theme')).toBe('nord');

    fixture.componentRef.setInput('theme', 'dracula');
    fixture.componentRef.setInput('uptimeMs', 900_000);
    fixture.componentRef.setInput('commands', 42);
    fixture.detectChanges();

    expect(valueFor('Theme')).toBe('nord');
    expect(valueFor('Uptime')).toBe('1s');
    expect(valueFor('Commands')).toBe('3');
  });

  it('arrives a word at a time rather than all at once', async () => {
    // Slow enough that the loop below cannot mistake a finished report for an
    // arriving one, and fast enough not to crawl.
    render({}, { msPerToken: 6 });

    // The logo is the block's shape, so it is there from the first frame; the text
    // is what arrives.
    expect(root().querySelector('pre')).toBeTruthy();

    const seen: string[] = [];
    for (let i = 0; i < 200; i++) {
      seen.push(text());
      if (root().querySelector('.neofetch')?.getAttribute('aria-busy') === null) break;
      await new Promise((resolve) => setTimeout(resolve, 6));
      fixture.detectChanges();
    }
    seen.push(text());

    const finished = seen.at(-1) ?? '';
    expect(rows()).toHaveLength(FULL_ROWS);
    expect(valueFor('Commands')).toBeTruthy();

    // It did not arrive at once: at least one earlier frame held less text.
    expect(seen.some((sample) => sample.length < finished.length)).toBe(true);
    // And every frame is a prefix of the next: the report only ever grows, into
    // exactly the text it was going to say.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].startsWith(seen[i - 1])).toBe(true);
    }
  });

  it('is not a live region, and is not busy once the report is finished', async () => {
    const busy = (): string | null =>
      root().querySelector('.neofetch')?.getAttribute('aria-busy') ?? null;

    render();
    await typed();

    // A live region would announce every word as it landed, so a screen reader
    // would hear "OS", "mpdev", "web", "terminal" instead of one finished line.
    expect(root().querySelector('[aria-live]')).toBeNull();
    expect(busy()).toBeNull();
  });

  it('puts the cursor on the row being typed', async () => {
    render({}, { msPerToken: 60 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    fixture.detectChanges();

    expect(root().querySelector('.caret-here')).toBeTruthy();
    // The cursor marks "more is coming", so it is the unfinished half of the state.
    expect(root().querySelector('.neofetch')?.getAttribute('aria-busy')).toBe('true');
  });

  it('retires the cursor once the last word has landed', async () => {
    // A caret that outlives the stream reads as a prompt waiting for input, and
    // this block is output.
    render();
    await typed();
    expect(root().querySelector('.caret-here')).toBeNull();
  });

  it('reserves the label column before any of it is on screen', async () => {
    /*
      The grid sizes that column to its content, so while the report is being typed
      every value already on screen would slide right each time a longer label
      lands. Reserving the finished width - "Resolution:" is the widest - is what
      keeps the values in one column the whole way through.
    */
    render();
    const style = root().querySelector('.details')?.getAttribute('style') ?? '';

    // "Resolution" is the longest label: ten cells, plus one for the colon.
    expect(style).toContain('--label-column: 11ch');
  });

  it('types the whole report at once when motion is reduced', async () => {
    // A cadence of a second a word would be the difference between reading the
    // report and waiting for it; the preference has to win.
    render({}, { msPerToken: 1000 }, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();

    expect(rows()).toHaveLength(FULL_ROWS);
    expect(valueFor('Commands')).toBeTruthy();
  });
});

describe('formatUptime', () => {
  it('counts seconds while the session is under a minute', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(4_000)).toBe('4s');
    expect(formatUptime(59_999)).toBe('59s');
  });

  it('switches to minutes and seconds at a minute', () => {
    expect(formatUptime(60_000)).toBe('1m 0s');
    expect(formatUptime(125_000)).toBe('2m 5s');
    expect(formatUptime(3_599_000)).toBe('59m 59s');
  });

  it('drops seconds once there are hours to report', () => {
    expect(formatUptime(3_600_000)).toBe('1h 0m');
    expect(formatUptime(7_500_000)).toBe('2h 5m');
  });

  it('never reports negative time', () => {
    expect(formatUptime(-5_000)).toBe('0s');
  });
});
