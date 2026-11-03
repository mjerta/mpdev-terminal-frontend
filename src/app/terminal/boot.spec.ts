import { TestBed } from '@angular/core/testing';

import { BOOT_TIMING, BootTiming, TerminalBoot } from './boot';

/**
 * Timing is injected so these tests stay fast and deterministic.
 *
 * Each case is sized so the service reaches `revealed` before it ends: the ticker
 * clears itself on reveal, and a test that abandons an un-revealed boot screen
 * would leave a live interval running past the suite.
 */
function bootWith(timing: Partial<BootTiming> = {}): TerminalBoot {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: BOOT_TIMING, useValue: { minimumMs: 20, timeoutMs: 60, ...timing } }],
  });
  return TestBed.inject(TerminalBoot);
}

const waited = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shownPercent = (subject: TerminalBoot) => Number(/(\d+)%/.exec(subject.hint())?.[1] ?? -1);
/** Every source the loader waits on. A new one has to be added here too. */
const ALL_SOURCES = ['identity', 'history', 'theme', 'font'] as const;

const settleAll = (subject: TerminalBoot) => {
  for (const source of ALL_SOURCES) subject.mark(source);
};

describe('TerminalBoot', () => {
  it('starts pending with nothing settled', () => {
    const subject = bootWith();
    expect(subject.ready()).toBe(false);
    expect(subject.has('identity')).toBe(false);
    expect(subject.showLoader()).toBe(true);
    settleAll(subject);
  });

  it('is ready only once every source has settled', async () => {
    const subject = bootWith({ minimumMs: 40, timeoutMs: 5000 });

    /*
      Each one in turn, asserting still-not-ready in between. Naming three sources
      by hand is how a fourth gets added to the loader and quietly forgotten here:
      this fails the moment the two lists disagree, because the last mark is the one
      that flips `ready` and it has to be the last of these.
    */
    for (const source of ALL_SOURCES.slice(0, -1)) {
      subject.mark(source);
      expect(subject.ready()).toBe(false);
    }

    subject.mark(ALL_SOURCES[ALL_SOURCES.length - 1]);
    expect(subject.ready()).toBe(true);
    await waited(80);
    expect(subject.showLoader()).toBe(false);
  });

  it('counts a source once however often it is marked', async () => {
    const subject = bootWith({ minimumMs: 40 });
    subject.mark('identity');
    subject.mark('identity');
    subject.mark('identity');
    expect(subject.ready()).toBe(false);

    settleAll(subject);
    expect(subject.ready()).toBe(true);
    await waited(80);
  });

  it('reports which sources have answered, independently of the rest', async () => {
    const subject = bootWith({ minimumMs: 30 });
    subject.mark('identity');
    expect(subject.has('identity')).toBe(true);
    expect(subject.has('theme')).toBe(false);
    settleAll(subject);
    await waited(60);
  });

  describe('hint', () => {
    it('is a plain climbing percentage with no bar glyphs', async () => {
      const subject = bootWith({ minimumMs: 120 });
      expect(subject.hint()).toBe('booting 0%');

      await waited(50);
      const mid = subject.hint();
      expect(mid).toMatch(/^booting \d+%$/);
      expect(mid).not.toMatch(/[█░]/);

      settleAll(subject);
      await waited(150);
    });

    it('climbs, never runs backwards, and never claims completion it has not got', async () => {
      // timeoutMs must outlast the dwell here, or the backstop reveals early and
      // freezes the ticker mid-climb.
      const subject = bootWith({ minimumMs: 200, timeoutMs: 5000 });
      const samples: number[] = [];
      for (let i = 0; i < 6; i++) {
        samples.push(shownPercent(subject));
        await waited(30);
      }

      expect(samples.every((value, i) => i === 0 || value >= samples[i - 1])).toBe(true);
      expect(samples.at(-1)).toBeGreaterThan(samples[0]);
      expect(Math.max(...samples)).toBeLessThan(100);

      // Plateaus just short of a hundred while the dwell runs out.
      settleAll(subject);
      await waited(200);
      expect(shownPercent(subject)).toBe(99);
    });
  });

  describe('reveal', () => {
    it('holds the boot screen past instant readiness', async () => {
      /*
        The point of the dwell. IndexedDB is local disk and answers in milliseconds,
        so a purely readiness-gated screen would be invisible on every real device.
      */
      const subject = bootWith({ minimumMs: 150, timeoutMs: 5000 });
      settleAll(subject);
      expect(subject.ready()).toBe(true);
      expect(subject.showLoader()).toBe(true);

      await waited(250);
      expect(subject.showLoader()).toBe(false);
      expect(subject.revealed()).toBe(true);
    });

    it('still waits for real work that outlasts the dwell', async () => {
      const subject = bootWith({ minimumMs: 20, timeoutMs: 5000 });
      subject.mark('identity');
      await waited(60);
      expect(subject.showLoader()).toBe(true);

      settleAll(subject);
      expect(subject.showLoader()).toBe(false);
    });

    it('lifts on the backstop when a source never settles', async () => {
      /*
        The invariant "every declared source must be marked" is real. Breaking it
        used to mean a terminal frozen on a progress bar forever; a forgotten mark
        now costs one boot screen, not the app.
      */
      const subject = bootWith({ minimumMs: 20, timeoutMs: 60 });
      subject.mark('identity');
      subject.mark('history');
      expect(subject.ready()).toBe(false);

      await waited(140);
      expect(subject.showLoader()).toBe(false);
      expect(subject.revealed()).toBe(true);
    });

    it('reveal never goes backwards once lifted', async () => {
      const subject = bootWith({ minimumMs: 20, timeoutMs: 60 });
      await waited(140);
      expect(subject.revealed()).toBe(true);

      settleAll(subject);
      expect(subject.revealed()).toBe(true);
    });
  });

  describe('defaults', () => {
    it('ships a one second dwell and a three second backstop', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      expect(TestBed.inject(BOOT_TIMING)).toEqual({ minimumMs: 1000, timeoutMs: 3000 });
    });
  });
});
