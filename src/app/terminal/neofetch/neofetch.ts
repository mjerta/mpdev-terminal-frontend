import {
  Component,
  ElementRef,
  OnInit,
  Renderer2,
  afterNextRender,
  inject,
  input,
  viewChild,
} from '@angular/core';

import { FICTIONAL_TERMINAL } from '../terminal.config';

/** One row of the report: the label in the left column, its value on the right. */
interface Detail {
  readonly label: string;
  readonly value: string;
}

/**
 * Block-letter MPDEV in the "ANSI Shadow" style.
 *
 * Every row is exactly 48 columns wide, which is not cosmetic: the stylesheet
 * sizes the art as `48 * 0.6em` (JetBrains Mono's advance width) against the
 * container, so a row that was a column short or long would leave the logo
 * clipped on one edge or drifting away from the right margin on the other.
 * `neofetch.spec.ts` holds that invariant.
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

  protected readonly config = FICTIONAL_TERMINAL;

  /** The logo, exposed for the template and for the width invariant in the spec. */
  protected readonly art = LOGO;

  /** Captured once in ngOnInit; see the class comment on why it is not live. */
  protected who = '';
  protected details: readonly Detail[] = [];

  private readonly logo = viewChild<ElementRef<HTMLElement>>('logo');
  private readonly renderer = inject(Renderer2);

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
      this.sizeLogo();
      const stopResize = this.renderer.listen('window', 'resize', () => this.sizeLogo());
      /*
        The bundled face can finish loading after the first measure, and the metrics
        come from whichever font is actually drawn. Re-run once it has settled; the
        viewChild is empty by then if the view has gone, so a destroyed block is safe.
      */
      void document.fonts?.ready.then(() => this.sizeLogo());
      return () => stopResize();
    });
  }

  ngOnInit(): void {
    this.who = this.user();
    this.details = this.describe();
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

    this.renderer.removeStyle(el, 'font-size');
    const ideal = parseFloat(getComputedStyle(el).fontSize);
    const snapped = snapToWholeCells(ideal, this.config.font.advanceRatio, devicePixelRatio);
    if (snapped === null || Math.abs(snapped - ideal) < 1e-6) return;

    this.renderer.setStyle(el, 'font-size', `${snapped}px`);
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
      { label: 'Font', value: this.fontName() },
      { label: 'Resolution', value: this.resolution() },
      { label: 'Uptime', value: formatUptime(this.uptimeMs()) },
      { label: 'Commands', value: String(this.commands()) },
    ];
  }

  /**
   * The first family in the config's font stack, unquoted.
   *
   * The whole stack is a CSS declaration, and printing `'JetBrainsMono Nerd Font',
   * 'JetBrainsMono NF', 'Adwaita Mono', ...` would wrap across three lines on a
   * phone. The first entry is the one that is actually drawn.
   */
  private fontName(): string {
    const [first = ''] = this.config.font.family.split(',');
    return first.trim().replace(/^['"]|['"]$/g, '');
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
