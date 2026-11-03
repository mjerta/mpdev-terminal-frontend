import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';

/**
 * The asynchronous sources the first frame depends on. Each must be marked
 * exactly once, including when there was nothing to load: a source that never
 * runs still has to settle, or the boot screen has to wait for it.
 *
 * - `identity`: the guest name from IndexedDB (immediate when config pins a user)
 * - `history`: the persisted command list
 * - `theme`: the chosen palette
 * - `font`: the chosen family
 *
 * `theme` and `font` are both held until the reveal for the same reason: painting
 * the default and then swapping to the stored value under a lifted loader is a
 * visible change of appearance the visitor never asked to see.
 */
export type BootSource = 'identity' | 'history' | 'theme' | 'font';

const SOURCES: readonly BootSource[] = ['identity', 'history', 'theme', 'font'];

/** Boot screen timing. Overridable so tests do not have to wait a second. */
export interface BootTiming {
  /** How long the boot screen stays up even if everything settled instantly. */
  readonly minimumMs: number;
  /** Backstop: lift regardless, so a forgotten source cannot brick the screen. */
  readonly timeoutMs: number;
}

export const BOOT_TIMING = new InjectionToken<BootTiming>('terminal.bootTiming', {
  providedIn: 'root',
  factory: () => ({ minimumMs: 1000, timeoutMs: 3000 }),
});

/** How often the displayed percentage is refreshed while the boot screen is up. */
const TICK_MS = 40;

/**
 * Drives the boot sequence: the percentage, and when to reveal.
 *
 * Two phases, each doing something honest.
 *
 * *Booting* shows a percentage of the known dwell window. There is a real fixed
 * duration to measure against, so the number climbs smoothly; counting the settled
 * sources instead would read 0, jump, done. It is capped at 99 because
 * reaching a hundred is reserved for work that is genuinely finished.
 *
 * *Revealing* requires every source answered and the dwell elapsed, with a timeout
 * so a source that is never marked costs one boot screen rather than the app.
 *
 * Stored settings are held back until the reveal and applied then, so the palette
 * the visitor actually picked is the first one they see on the terminal rather
 * than a default that snaps to it a frame later. The colours themselves ease in
 * via the registered-token transition in `themes.scss`; this service only decides
 * *when* the value is allowed to change.
 */
@Injectable({ providedIn: 'root' })
export class TerminalBoot {
  private readonly settled = signal<ReadonlySet<BootSource>>(new Set());
  private readonly held = signal(false);
  private readonly gaveUp = signal(false);
  private readonly percent = signal(0);
  private readonly startedAt = Date.now();

  private readonly timing = inject(BOOT_TIMING);

  readonly ready = computed(() => this.settled().size === SOURCES.length);

  /** Revealed once the dwell is over *and* every source settled, or on timeout. */
  readonly revealed = computed(() => this.gaveUp() || (this.ready() && this.held()));

  /** True while the boot screen should be on top. */
  readonly showLoader = computed(() => !this.revealed());

  /** e.g. `booting 42%` - fraction of the boot window elapsed, held under 100. */
  readonly hint = computed(() => `booting ${this.percent()}%`);

  constructor() {
    /*
      The dwell and backstop timers are one-shot and never cleared: `revealed` is
      monotonic, so a timer landing after the fact sets a flag that changes nothing.
    */
    setTimeout(() => this.held.set(true), this.timing.minimumMs);
    setTimeout(() => this.gaveUp.set(true), this.timing.timeoutMs);

    const tick = setInterval(() => {
      const elapsed = Date.now() - this.startedAt;
      const reached = Math.min(99, Math.round((elapsed / this.timing.minimumMs) * 100));
      // Monotonic: a stalled source must never make the number run backwards.
      if (reached > this.percent()) this.percent.set(reached);
      if (this.revealed()) clearInterval(tick);
    }, TICK_MS);
  }

  /** Whether one specific source has answered, independent of the others. */
  has(source: BootSource): boolean {
    return this.settled().has(source);
  }

  /** Milliseconds since the app booted. `neofetch` prints this as uptime. */
  uptimeMs(): number {
    return Date.now() - this.startedAt;
  }

  mark(source: BootSource): void {
    if (this.settled().has(source)) return;
    this.settled.update((current) => new Set(current).add(source));
  }
}
