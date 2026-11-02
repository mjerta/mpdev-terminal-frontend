import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BOOT_TIMING, TerminalBoot } from '../../terminal/boot';
import { REVEAL_TIMING } from '../../terminal/neofetch/neofetch';
import { SettingsStore } from '../../terminal/settings.store';
import { MainContainer } from './main-container';

/**
 * A theme is a stored setting, but it must not be *painted* as soon as storage
 * answers. The boot screen is on top then, so applying it immediately means the
 * visitor's palette is briefly replaced by one they did not choose. These tests
 * pin the ordering: default during boot, stored theme only after the lift.
 */
class FakeSettings {
  constructor(private readonly stored: Record<string, unknown> = {}) {}
  readonly saved: Array<[string, unknown]> = [];

  async load<T>(key: string): Promise<T | undefined> {
    return this.stored[key] as T | undefined;
  }

  async save<T>(key: string, value: T): Promise<void> {
    this.saved.push([key, value]);
  }

  async guestName(): Promise<string> {
    return 'guest-test';
  }
}

describe('MainContainer', () => {
  let fixture: ComponentFixture<MainContainer>;
  let boot: TerminalBoot;

  const themeAttr = (): string | null =>
    (fixture.nativeElement as HTMLElement).querySelector('main')?.getAttribute('data-theme') ??
    null;

  const waited = async (ms: number): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    fixture.detectChanges();
  };

  /**
   * Wait for the greeting's report to finish arriving.
   *
   * Polled rather than a fixed delay: the block is only created when the boot
   * screen lifts, so its typing starts later than the dwell this file otherwise
   * waits for, and a report caught mid-sentence has no rows to read yet.
   */
  async function reportTyped(): Promise<void> {
    for (let i = 0; i < 250; i++) {
      const report = (fixture.nativeElement as HTMLElement).querySelector('.neofetch');
      if (report && report.getAttribute('aria-busy') === null) return;
      await new Promise((resolve) => setTimeout(resolve, 2));
      fixture.detectChanges();
    }
  }

  async function render(settings: FakeSettings): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MainContainer],
      providers: [
        { provide: SettingsStore, useValue: settings },
        // Long enough to observe, short enough not to slow the suite. The
        // backstop is effectively off so the reveal is decided by the dwell.
        { provide: BOOT_TIMING, useValue: { minimumMs: 250, timeoutMs: 60_000 } },
        // The greeting types itself in; this keeps that from being the wait.
        { provide: REVEAL_TIMING, useValue: { msPerToken: 1 } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MainContainer);
    boot = TestBed.inject(TerminalBoot);
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', async () => {
    await render(new FakeSettings());
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('holds a stored theme back until the boot screen lifts', async () => {
    await render(new FakeSettings({ theme: 'dracula' }));
    // Storage has answered by now; the boot screen has not lifted.
    await waited(80);
    expect(boot.has('theme')).toBe(true);
    expect(boot.showLoader()).toBe(true);
    expect(themeAttr()).toBe('tokyo-night');

    await waited(300);
    expect(boot.showLoader()).toBe(false);
    expect(themeAttr()).toBe('dracula');
  });

  it('prints the greeting under the stored theme, not the default', async () => {
    /*
      The greeting and the palette are applied by two different effects on the same
      reveal, so their order is the thing that can quietly break: a report printed
      a frame early would name `tokyo-night` under a page already wearing dracula.
      A report is a snapshot, so it would then keep saying the wrong thing.
    */
    await render(new FakeSettings({ theme: 'dracula' }));
    await waited(350);
    await reportTyped();

    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-neofetch .row'),
    );
    const reported = rows
      .find((row) => row.querySelector('dt')?.textContent?.trim() === 'Theme:')
      ?.querySelector('dd')
      ?.textContent?.trim();

    expect(themeAttr()).toBe('dracula');
    expect(reported).toBe('dracula');
  });

  it('ignores a stored theme that no longer exists', async () => {
    await render(new FakeSettings({ theme: 'a-theme-we-removed' }));
    await waited(350);
    expect(boot.showLoader()).toBe(false);
    expect(themeAttr()).toBe('tokyo-night');
  });

  it('keeps a theme the visitor picks during boot', async () => {
    const settings = new FakeSettings({ theme: 'dracula' });
    await render(settings);

    // The dropdown is live while booting; picking must win over the slow load.
    const dropdown = fixture.debugElement.query((el) => el.name === 'app-theme-dropdown');
    dropdown.triggerEventHandler('selectedIdChange', 'nord');
    fixture.detectChanges();
    expect(themeAttr()).toBe('nord');

    await waited(350);
    expect(themeAttr()).toBe('nord');
    expect(settings.saved).toEqual([['theme', 'nord']]);
  });
});
