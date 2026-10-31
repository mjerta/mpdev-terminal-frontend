import { TestBed } from '@angular/core/testing';

import { TerminalBoot } from './boot';

describe('TerminalBoot', () => {
  function boot(): TerminalBoot {
    return TestBed.inject(TerminalBoot);
  }

  it('starts unfinished at zero', () => {
    const subject = boot();
    expect(subject.ready()).toBe(false);
    expect(subject.progress()).toBe(0);
  });

  it('is ready only once every source has settled', () => {
    const subject = boot();
    subject.mark('identity');
    subject.mark('history');
    expect(subject.ready()).toBe(false);
    expect(Math.round(subject.progress())).toBe(67);

    subject.mark('theme');
    expect(subject.ready()).toBe(true);
    expect(subject.progress()).toBe(100);
  });

  it('counts a source once however often it is marked', () => {
    const subject = boot();
    subject.mark('identity');
    subject.mark('identity');
    subject.mark('identity');
    expect(Math.round(subject.progress())).toBe(33);
  });

  it('reports progress as a percentage and a bar', () => {
    const subject = boot();
    subject.mark('identity');
    expect(subject.hint()).toBe('booting 33% ████░░░░░░░░');
  });

  it('never lifts the loader on its own once a source is missing', () => {
    /*
      The invariant the design rests on: every declared source must be marked,
      including paths that decide not to load anything. This pins the behaviour so
      a future source added to the list cannot silently hang the loader forever.
    */
    const subject = boot();
    subject.mark('identity');
    subject.mark('history');
    expect(subject.ready()).toBe(false);
  });

  describe('loader visibility', () => {
    /*
      Real delays rather than fake timers: the app is zoneless, so Angular's
      fakeAsync helper is unavailable (it needs zone-testing.js), and the thing
      under test is a plain timer writing a signal. 250ms of wall clock is a fair
      price for testing that honestly.
    */
    const waited = () => new Promise((resolve) => setTimeout(resolve, 250));

    it('stays hidden when boot finishes before the delay elapses', async () => {
      const subject = boot();
      subject.mark('identity');
      subject.mark('history');
      subject.mark('theme');
      await waited();
      expect(subject.ready()).toBe(true);
      expect(subject.showLoader()).toBe(false);
    });

    it('appears when storage really is slow', async () => {
      const subject = boot();
      await waited();
      expect(subject.showLoader()).toBe(true);
      expect(subject.hint()).toContain('booting 0%');
    });

    it('lifts as soon as the last source settles', async () => {
      const subject = boot();
      await waited();
      expect(subject.showLoader()).toBe(true);

      subject.mark('identity');
      subject.mark('history');
      subject.mark('theme');
      expect(subject.showLoader()).toBe(false);
    });
  });
});
