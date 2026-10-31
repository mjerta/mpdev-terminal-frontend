import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Keeps the shell exactly as tall as the area the user can actually see.
 *
 * Why this exists: on a phone the soft keyboard does not shrink the layout
 * viewport, only the visual one. Our shell is `100dvh` tall, so with the keyboard
 * open the bottom of it - the live prompt line and the caret - sits behind the
 * keyboard, which is the one line that must stay readable.
 *
 * `window.visualViewport.height` does report the area left above the keyboard, so
 * this publishes it as `--viewport-height` and lets the `html` height follow it,
 * making the shell shrink to fit. The existing bottom-pinning in the terminal then
 * keeps the newest line in the shortened view.
 *
 * Two graceful exits:
 * - No VisualViewport (older browsers, jsdom): nothing is published and the CSS
 *   falls back to `100dvh`, so behaviour is unchanged.
 * - Before this runs on first paint: same fallback.
 */
@Injectable({ providedIn: 'root' })
export class VisibleViewport {
  /** Visible height in px, 0 when the API is unavailable. */
  readonly height = signal(0);

  private readonly doc = inject(DOCUMENT);

  constructor() {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!viewport) return;

    const sync = () => this.apply(viewport.height);
    sync();
    viewport.addEventListener('resize', sync);

    // The listener would otherwise outlive the injector in tests.
    inject(DestroyRef).onDestroy(() => viewport.removeEventListener('resize', sync));
  }

  private apply(px: number): void {
    const rounded = Math.round(px);
    if (rounded === this.height()) return;
    this.height.set(rounded);
    this.doc.documentElement.style.setProperty('--viewport-height', `${rounded}px`);
  }
}
