import { Component, OnInit, input } from '@angular/core';

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

  ngOnInit(): void {
    this.who = this.user();
    this.details = this.describe();
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
