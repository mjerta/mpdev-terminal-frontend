import { Injectable, computed, signal } from '@angular/core';

/**
 * The asynchronous sources the first real frame depends on. Each must be marked
 * exactly once, including when there was nothing to load: a source that never
 * runs still has to settle, or the loader never lifts.
 *
 * - `identity`: the guest name from IndexedDB (immediate when config pins a user)
 * - `history`: the persisted command list
 * - `theme`: the chosen palette
 */
export type BootSource = 'identity' | 'history' | 'theme';

const SOURCES: readonly BootSource[] = ['identity', 'history', 'theme'];

/**
 * How long to stay silent before admitting the boot is actually slow.
 *
 * IndexedDB normally answers within a few milliseconds, so a loader shown
 * immediately would flash for one frame on every visit. Delaying the reveal keeps
 * the fast path invisible and still surfaces a real indicator when storage is
 * genuinely slow or blocked.
 */
const LOADER_DELAY_MS = 150;

/**
 * Tracks when the app's stored state has arrived, so the terminal can say "still
 * fetching" instead of rendering a confident placeholder.
 *
 * The problem this exists for: the guest name comes from IndexedDB, so the first
 * frame would otherwise show `guest@mpdev` before resolving to
 * `guest-x32a@mpdev`. That placeholder is not neutral, it reads as a finished
 * answer, and the identity segment is withheld until then.
 */
@Injectable({ providedIn: 'root' })
export class TerminalBoot {
  private readonly settled = signal<ReadonlySet<BootSource>>(new Set());
  private readonly slow = signal(false);

  /** Percentage of sources that have answered, 0..100. */
  readonly progress = computed(() => (this.settled().size / SOURCES.length) * 100);

  readonly ready = computed(() => this.settled().size === SOURCES.length);

  /** True only while a *noticeably* slow boot is still outstanding. */
  readonly showLoader = computed(() => this.slow() && !this.ready());

  /**
   * e.g. `booting 67% ████████░░░░`. Real completed-source count, never a
   * decorative spin.
   *
   * Coarse by construction: every source awaits the same one connection promise,
   * so in practice this tends to read `0%` and then complete rather than climbing
   * smoothly. That is the honest version of the number; interpolating between the
   * two would be theatre dressed as progress.
   */
  readonly hint = computed(() => {
    const percent = Math.round(this.progress());
    const cells = 12;
    const filled = Math.round((percent / 100) * cells);
    return `booting ${percent}% ${'█'.repeat(filled)}${'░'.repeat(cells - filled)}`;
  });

  constructor() {
    /*
      One-shot, deliberately. `showLoader` also requires `!ready()`, and readiness
      is monotonic, so a timer that fires after a fast boot sets a flag that is
      never displayed. That is simpler than arming and disarming on every change,
      and it keeps the service free of scheduling side effects.
    */
    setTimeout(() => this.slow.set(true), LOADER_DELAY_MS);
  }

  mark(source: BootSource): void {
    if (this.settled().has(source)) return;
    this.settled.update((current) => new Set(current).add(source));
  }
}
