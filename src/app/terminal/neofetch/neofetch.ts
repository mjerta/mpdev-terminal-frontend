import {
  Component,
  ElementRef,
  InjectionToken,
  OnInit,
  Renderer2,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { drawnFamily, FICTIONAL_TERMINAL, FontChoice } from '../terminal.config';

/** One row of the report: the label in the left column, its value on the right. */
interface Detail {
  readonly label: string;
  readonly value: string;
}

/** Reveal cadence for the report. Its own token so tests need not wait a second. */
export const REVEAL_TIMING = new InjectionToken<{ readonly msPerToken: number }>(
  'neofetch.revealTiming',
  {
    providedIn: 'root',
    factory: () => FICTIONAL_TERMINAL.reveal,
  },
);

/**
 * Whether the visitor has asked for less motion.
 *
 * A token rather than a call at the use site: the preference is an environment
 * fact, it is only worth reading once, and jsdom has no way to report it - so a
 * direct call would leave the one behaviour that has to do nothing on request
 * untestable.
 */
export const REDUCED_MOTION = new InjectionToken<boolean>('neofetch.reducedMotion', {
  providedIn: 'root',
  factory: () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
});

/** Where on screen a landed word goes. */
export type StreamSlot = 'user' | 'host' | 'label' | 'value';

/**
 * The smallest thing the stream emits: one word, and the slot it lands in.
 *
 * Words rather than characters because the report is a layout, not a string: a
 * label and its value sit in different grid cells, so there is no single line of
 * text to slice. A word is the largest unit that still has one obvious home.
 */
export interface StreamWord {
  readonly slot: StreamSlot;
  /** Index into the report's rows; -1 for the identity line. */
  readonly row: number;
  readonly text: string;
}

/** A row as far as it has been typed: the label always arrives whole. */
export interface ShownRow {
  readonly label: string;
  readonly value: string;
}

/** Everything the template needs to know about how far the typing has got. */
export interface Reveal {
  readonly user: string;
  readonly host: string;
  readonly rows: readonly ShownRow[];
  /**
   * Row holding the last word that landed, which is where the cursor sits: -1 for
   * the identity line. Null once the report is complete, and before it starts.
   */
  readonly caretRow: number | null;
  readonly done: boolean;
}

/**
 * The whole report as the order it is typed out in, one word per entry.
 *
 * Computed once when the block is created rather than derived on every tick: the
 * text is a snapshot, so the plan cannot change under the stream.
 */
export function streamWords(
  who: string,
  host: string,
  details: readonly { readonly label: string; readonly value: string }[],
): readonly StreamWord[] {
  const words: StreamWord[] = [];
  if (who) words.push({ slot: 'user', row: -1, text: who });
  if (host) words.push({ slot: 'host', row: -1, text: host });

  details.forEach((detail, index) => {
    if (detail.label) words.push({ slot: 'label', row: index, text: detail.label });
    for (const word of detail.value.split(/\s+/)) {
      if (word) words.push({ slot: 'value', row: index, text: word });
    }
  });

  return words;
}

/**
 * The report as it looks after `emitted` words have landed.
 *
 * The one promise this makes, and the reason the effect reads as output rather
 * than as a fade-in: what is on screen is always a *prefix* of the finished
 * report. Nothing is rewritten, nothing is reordered, and a word that has landed
 * never moves.
 */
export function revealAt(words: readonly StreamWord[], emitted: number): Reveal {
  const shown = Math.max(0, Math.min(emitted, words.length));
  let user = '';
  let host = '';
  let caretRow: number | null = null;
  const labels = new Map<number, string>();
  const values = new Map<number, string[]>();

  for (let i = 0; i < shown; i++) {
    const word = words[i];
    caretRow = word.row;
    switch (word.slot) {
      case 'user':
        user = word.text;
        break;
      case 'host':
        host = word.text;
        break;
      case 'label':
        labels.set(word.row, word.text);
        break;
      case 'value':
        values.set(word.row, [...(values.get(word.row) ?? []), word.text]);
        break;
    }
  }

  // In row order, and only as far as the typing has reached: a row whose label has
  // not landed does not exist yet, which is what makes the block grow downwards.
  const placed: { row: number; label: string; value: string }[] = [];
  labels.forEach((label, row) =>
    placed.push({ row, label, value: (values.get(row) ?? []).join(' ') }),
  );
  placed.sort((a, b) => a.row - b.row);

  return {
    user,
    host,
    rows: placed.map(({ label, value }) => ({ label, value })),
    /*
      The cursor marks "more is coming", so it goes when the last word lands. One
      that outlives the stream reads as a prompt waiting for input, and this block
      is output, not input.
    */
    caretRow: shown >= words.length ? null : caretRow,
    done: shown >= words.length,
  };
}

/**
 * How many cells the probe measures to work out a face's advance.
 *
 * A hundred rather than one: one glyph's width comes back rounded to the layout's
 * subpixel grid, and dividing a hundred of them spreads that error over two
 * decimal places instead of leaving it as the whole answer.
 */
const CELL_PROBE_COUNT = 100;

/**
 * Block-letter MPDEV in the "ANSI Shadow" style.
 *
 * Every row is exactly 48 columns wide, which is not cosmetic: the stylesheet
 * sizes the art from that width (`48 * ratio * fontSize`, the ratio measured from
 * the face in use) against the viewport, so a row that was a column short or long
 * would leave the logo clipped on one edge or drifting away from the right margin
 * on the other. `neofetch.spec.ts` holds that invariant.
 */
const LOGO = [
  '███╗   ███╗ ██████╗  ██████╗  ███████╗ ██╗   ██╗',
  '████╗ ████║ ██╔══██╗ ██╔══██╗ ██╔════╝ ██║   ██║',
  '██╔████╔██║ ██████╔╝ ██║  ██║ █████╗   ██║   ██║',
  '██║╚██╔╝██║ ██╔═══╝  ██║  ██║ ██╔══╝   ╚██╗ ██╔╝',
  '██║ ╚═╝ ██║ ██║      ██████╔╝ ███████╗  ╚████╔╝ ',
  '╚═╝     ╚═╝ ╚═╝      ╚═════╝  ╚══════╝   ╚═══╝  ',
].join('\n');

/**
 * The `neofetch` block: a block-letter logo beside a short system report.
 *
 * Deliberately a component rather than printed lines. The report is a two-column
 * layout whose left column is a fixed-width label, and the logo is decorative art
 * that has to scale with the viewport - neither survives being flattened into the
 * `output` strings the rest of the terminal deals in. Everything the rest of the
 * terminal renders stays a string; this is the one exception, and it is one on
 * purpose.
 *
 * A report is a snapshot, so every value is captured once, when the block first
 * renders, rather than read live from the inputs. Scrolling back to a `neofetch`
 * from five minutes ago must still show the uptime and command count it printed
 * then, not today's numbers under yesterday's logo.
 *
 * The text then arrives a word at a time, the way streamed output does. Only the
 * text: the logo is the block's shape, and making it arrive gradually would mean
 * the report sliding around the screen as the art grew.
 */
@Component({
  selector: 'app-neofetch',
  templateUrl: './neofetch.html',
  styleUrl: './neofetch.scss',
})
export class Neofetch implements OnInit {
  /** Who is logged in, exactly as the prompt spells it. */
  readonly user = input('guest');
  /** The active palette id. Shown as text; the art recolours itself through CSS. */
  readonly theme = input('tokyo-night');
  /** App uptime in milliseconds when the block was printed. */
  readonly uptimeMs = input(0);
  /** Commands run so far, including the one that printed this. */
  readonly commands = input(0);
  /**
   * The font the block is drawn in.
   *
   * Passed down rather than read from config because config only knows the default:
   * the choice is state the visitor owns, and a report that printed the default
   * while showing art in something else would be the one place the two disagree.
   */
  readonly font = input<FontChoice>(FICTIONAL_TERMINAL.fonts[0]);

  protected readonly config = FICTIONAL_TERMINAL;

  /** The logo, exposed for the template and for the width invariant in the spec. */
  protected readonly art = LOGO;

  /** Captured once in ngOnInit; see the class comment on why it is not live. */
  protected who = '';
  protected details: readonly Detail[] = [];

  /**
   * Width to reserve for the label column, in cells.
   *
   * Computed from the finished report rather than from what has landed, because
   * the grid's max-content column grows each time a longer label arrives and
   * would otherwise shove every value already on screen to the right. `ch` is one
   * cell in a monospace font, and the colon is one of those cells.
   */
  protected labelColumn = 'max-content';

  /** The report in typing order. Fixed once built: a snapshot cannot reflow. */
  private readonly words = signal<readonly StreamWord[]>([]);
  /** How many words have landed. The only thing the timer touches. */
  private readonly emitted = signal(0);
  private revealTimer: ReturnType<typeof setInterval> | undefined;

  private readonly logo = viewChild<ElementRef<HTMLElement>>('logo');
  private readonly renderer = inject(Renderer2);
  private readonly timing = inject(REVEAL_TIMING);
  private readonly reducedMotion = inject(REDUCED_MOTION);

  /** What the template draws: the report as far as it has been typed. */
  protected readonly stream = computed(() => revealAt(this.words(), this.emitted()));

  constructor() {
    /*
      The art is laid out in cells, and it only reads as solid letters when a cell
      edge lands on a whole device pixel. See `snapToWholeCells`.

      Registered after render because it measures the element. The returned function
      is the teardown: Angular drops the window listener with the view, so a scrollback
      full of reports does not accumulate listeners.

      Deliberately not part of the snapshot in `details`: this is presentation, and it
      has to keep answering to the viewport when the phone rotates.
    */
    afterNextRender(() => {
      this.startStream();
      const stopResize = this.renderer.listen('window', 'resize', () => this.sizeLogo());
      /*
        The bundled face can finish loading after the first measure, and the metrics
        come from whichever font is actually drawn. Re-run once it has settled; the
        viewChild is empty by then if the view has gone, so a destroyed block is safe.
      */
      void document.fonts?.ready.then(() => this.sizeLogo());
      return () => {
        stopResize();
        clearInterval(this.revealTimer);
      };
    });

    /*
      Re-fit whenever the family changes.
      This must be an after-render effect and not a plain one: the measurement reads
      the font the element is actually drawn in, and during an ordinary effect the
      new `--font-terminal` has not reached the DOM yet, so it would measure the face
      being replaced. It also runs for every block already on screen, because they
      inherit the change too - which is why the fit is a reaction and not something
      the command does to the newest block only.
    */
    afterRenderEffect(() => {
      this.font();
      this.sizeLogo();
    });
  }

  ngOnInit(): void {
    this.who = this.user();
    this.details = this.describe();
    this.labelColumn = `${this.widestLabel()}ch`;
    this.words.set(streamWords(this.who, this.config.host, this.details));
  }

  /** Longest label plus its colon, in cells. Zero rows means nothing to reserve. */
  private widestLabel(): number {
    return this.details.reduce((widest, detail) => Math.max(widest, detail.label.length + 1), 0);
  }

  /**
   * Let the report arrive a word at a time.
   *
   * One interval, one counter: the words are already planned, so the timer has
   * nothing to decide and the rendering is a pure function of the counter. That
   * keeps the effect honest under load - a slow frame drops a tick, not a word.
   */
  private startStream(): void {
    const total = this.words().length;
    if (total === 0 || this.emitted() >= total) return;

    // See REDUCED_MOTION: asked-for calm means no wait to read the report.
    if (this.reducedMotion) {
      this.emitted.set(total);
      return;
    }

    this.revealTimer = setInterval(() => {
      const next = this.emitted() + 1;
      this.emitted.set(next);
      if (next >= total) clearInterval(this.revealTimer);
    }, this.timing.msPerToken);
  }

  /** Whether the typing cursor belongs at the end of this row. -1 is the identity. */
  protected caretInRow(row: number): boolean {
    return this.stream().caretRow === row;
  }

  /**
   * Round the art's font size down to one whose cell is a whole device pixel.
   *
   * CSS owns the choice of size - the share of the viewport, the cap at the
   * terminal's text size - so this asks it what it picked, then takes the nearest
   * size at or below that answer. Nothing is duplicated, and if the browser cannot
   * measure (jsdom, or a font size of zero) the CSS value simply stands.
   */
  private sizeLogo(): void {
    const el = this.logo()?.nativeElement;
    if (!el) return;

    /*
      Publish the cell width of the face actually in use before asking CSS for a
      size, because CSS needs it: the art is `48 * ratio * fontSize` wide, so a face
      whose cells are wider than the bundled one has to be sized down by the same
      proportion to occupy the same space. Measured on this machine all three offered
      choices land on 0.6em - a *lone* `ui-monospace` is 0.71em for the block glyphs,
      but every entry here has `monospace` behind it, which is what flattens that -
      so this is insurance for the devices this one cannot test, not a fix for
      anything observed here.

      Measured from the element's own inherited family rather than from the config
      entry, so a block already on screen from before a font change is fitted to the
      face it is really drawn in.
    */
    const ratio = this.measureCellRatio(el) || this.config.font.advanceRatio;
    this.renderer.setStyle(el, '--cell-ratio', String(ratio));

    this.renderer.removeStyle(el, 'font-size');
    const ideal = parseFloat(getComputedStyle(el).fontSize);
    /*
      No computed size means there is nothing to measure. A detached element reports
      an empty font-size in Chromium - which is what an after-render hook sees if the
      view has not been inserted yet - and jsdom reports it for every element, laid
      out or not.

      Worth being exact about what this prevents: `${NaN}px` never reaches the art,
      because both engines drop an invalid declaration silently. So this is not
      corruption, it is a loop that would run four times measuring zero against zero
      and conclude nothing. CSS already has the size; it keeps it.
    */
    if (!(ideal > 0)) return;

    let size = this.snapToCells(ideal, ratio);

    /*
      Then make the fit an observation instead of a derivation.

      The maths above says 48 columns of this face at this size takes about 69% of
      the viewport, and in a browser that renders the size it was asked for, it
      does. But the size can be overridden from outside the page - a minimum font
      size, Android's font-scale setting, a substituted face wider than the one
      measured, a `calc()` the browser declines to parse - and then 48 columns are
      simply wider than the box with nothing left to catch it. `scrollWidth` past
      `clientWidth` is that catch: it is what a scroller panning sideways actually
      is, so the art is shrunk until it stops being true.

      Width is proportional to size, so one pass normally lands exactly. The loop is
      only for the rounding tie that can leave one device pixel over.
    */
    for (let attempt = 0; attempt < 4; attempt++) {
      this.renderer.setStyle(el, 'font-size', `${size}px`);
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow <= 0) break;

      const smaller = this.snapToCells((size * el.clientWidth) / el.scrollWidth, ratio);
      // Stops rather than looping forever when no whole-pixel size below this one
      // exists: an art that is a little too wide beats one that vanished.
      if (smaller >= size) break;
      size = smaller;
    }
  }

  /** The nearest cell-aligned size at or below `px`, or `px` where there is none. */
  private snapToCells(px: number, ratio: number): number {
    return snapToWholeCells(px, ratio, devicePixelRatio) ?? px;
  }

  /**
   * The drawn face's glyph advance as a fraction of the font size, or 0 when the
   * browser cannot be asked.
   *
   * Measured in the DOM rather than on a canvas because it has to be the number the
   * layout engine will use: a canvas resolves a generic family like `ui-monospace`
   * differently from a element, and the difference is exactly what this is meant to
   * correct.
   *
   * The probe is a child of the art, so it inherits the same family, weight and
   * OpenType settings, and a hundred cells amortise the fractional rounding away.
   */
  private measureCellRatio(el: HTMLElement): number {
    const probe = this.renderer.createElement('span');
    this.renderer.setAttribute(probe, 'aria-hidden', 'true');
    this.renderer.setStyle(probe, 'font-size', '100px');
    this.renderer.setStyle(probe, 'line-height', '1');
    this.renderer.setStyle(probe, 'white-space', 'pre');
    this.renderer.setProperty(probe, 'textContent', '█'.repeat(CELL_PROBE_COUNT));
    this.renderer.appendChild(el, probe);
    const width = probe.getBoundingClientRect().width;
    this.renderer.removeChild(el, probe);

    const ratio = width / CELL_PROBE_COUNT / 100;
    /*
      Plausible-only: 0 when jsdom reports no layout, and a sane monospace is
      nowhere near these bounds, so a wild value cannot quietly shrink the art to
      nothing. Outside the range the config's ratio stands.
    */
    return Number.isFinite(ratio) && ratio >= 0.4 && ratio <= 1 ? ratio : 0;
  }

  /**
   * The report, in the order neofetch prints it: identity, then the machine.
   *
   * Static values come from the config map so the logo and the prompt cannot
   * disagree about the host; the rest is measured at print time.
   */
  private describe(): readonly Detail[] {
    return [
      { label: 'OS', value: this.config.system.os },
      { label: 'Host', value: this.config.host },
      { label: 'Kernel', value: this.config.system.kernel },
      { label: 'Shell', value: this.config.shell },
      { label: 'Terminal', value: this.config.system.terminal },
      { label: 'Theme', value: this.theme() },
      // Two words: "JetBrainsMono Nerd Font". Counted by the budget in the spec.
      { label: 'Font', value: this.fontName() },
      { label: 'Resolution', value: this.resolution() },
      // Two words at most: "2h 5m" / "1m 4s" / "4s".
      { label: 'Uptime', value: formatUptime(this.uptimeMs()) },
      { label: 'Commands', value: String(this.commands()) },
    ];
  }

  /**
   * The first family in the chosen stack, unquoted.
   *
   * The whole stack is a CSS declaration, and printing `'JetBrainsMono Nerd Font',
   * 'JetBrainsMono NF', 'Adwaita Mono', ...` would wrap across three lines on a
   * phone. The first entry is the one the browser is asked to draw.
   */
  private fontName(): string {
    return drawnFamily(this.font().family);
  }

  /**
   * Physical screen resolution, the way neofetch reports it: CSS pixels times the
   * device pixel ratio.
   *
   * `screen` is missing in some embedded browsers and reports zero under jsdom, so
   * the viewport stands in rather than the report claiming `0x0`.
   */
  private resolution(): string {
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const width = screen?.width || innerWidth;
    const height = screen?.height || innerHeight;
    return `${Math.round(width * dpr)}x${Math.round(height * dpr)}`;
  }
}

/**
 * The largest font size at or below `idealPx` whose glyph cell is a whole number
 * of device pixels, or null when there is nothing sensible to snap to.
 *
 * Monospace art is a grid of cells, and a cell of `0.6 * 9.286px * 3` is 16.7
 * device pixels wide. The rasteriser cannot put an edge on a seventh of a pixel,
 * so it rounds each glyph separately: the stems of `║` land two device pixels wide
 * in one row and three in the next, and the block letters look lean and uneven.
 * This is the "slightly slanted logo" that shows up on phones, and it is purely a
 * consequence of the size, not the font.
 *
 * Sizing so the cell is integral fixes it: cell widths are `advanceRatio * size *
 * dpr`, so the sizes that work are spaced `1 / (advanceRatio * dpr)` apart, and
 * rounding down to that grid keeps the art inside the width CSS already chose.
 *
 * Rounding down rather than to nearest matters: the fit guarantee is against the
 * container, and the nearest snap can sit above it.
 */
export function snapToWholeCells(
  idealPx: number,
  advanceRatio: number,
  devicePixelRatio: number,
): number | null {
  if (!(idealPx > 0) || !(advanceRatio > 0) || !(devicePixelRatio > 0)) return null;

  const step = 1 / (advanceRatio * devicePixelRatio);
  const cells = Math.floor(idealPx / step + 1e-9);
  // Under one step there is no whole-pixel size that still shows the art; leave it
  // to CSS rather than collapsing the logo to nothing.
  if (cells < 1) return null;

  return +(cells * step).toFixed(6);
}

/**
 * Uptime the way `uptime` prints it: coarse at the top, never `0h 0m 4s`.
 *
 * Seconds only while the session is under a minute, because a freshly opened tab
 * reporting `0m 4s` reads like a clock that is stuck.
 */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
