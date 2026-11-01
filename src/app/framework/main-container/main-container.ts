import { Component, effect, inject, signal } from '@angular/core';
import { ThemeDropdown } from '../../ui-elements/theme-dropdown/theme-dropdown';
import { Card } from '../../ui-elements/card/card';
import { CardGrid } from '../../ui-elements/card-grid/card-grid';
import { SettingsStore } from '../../terminal/settings.store';
import { TerminalBoot } from '../../terminal/boot';
import { Terminal } from '../../terminal/terminal';
import { THEMES } from '../themes';

const DEFAULT_THEME = 'tokyo-night';

@Component({
  selector: 'app-main-container',
  standalone: true,
  imports: [ThemeDropdown, Card, CardGrid, Terminal],
  templateUrl: './main-container.html',
  styleUrl: './main-container.scss',
})
export class MainContainer {
  protected readonly themes = THEMES;

  /**
   * Single source of truth for the active theme, shared with the dropdown.
   *
   * Deliberately still the default while the boot screen is up: the stored choice
   * is held in `storedTheme` and applied at reveal, so the palette you actually
   * picked is the first theme painted, easing in rather than replacing a wrong one
   * a frame later.
   */
  protected readonly currentTheme = signal(DEFAULT_THEME);

  /** Flip to true to bring the theme preview wall back. */
  protected readonly showGallery = signal(false);

  protected readonly settings = inject(SettingsStore);
  private readonly boot = inject(TerminalBoot);

  /** Loaded from storage, applied once the boot screen lifts. */
  private readonly storedTheme = signal<string | null>(null);

  /** Set as soon as the user picks, so a slow load cannot overwrite their choice. */
  private userChose = false;

  constructor() {
    void this.settings.load<string>(SettingsStore.THEME).then((saved) => {
      /*
        Marked ahead of the early returns below. This source has answered as soon
        as the read resolves, whatever it decides to do with the value, so the
        loader must not keep waiting on a path that will never set anything.
      */
      this.boot.mark('theme');
      if (this.userChose) return;
      // Ignore anything that is not a theme we still have, so a removed id from
      // an older visit cannot leave the app unstyled.
      if (saved && THEMES.some((theme) => theme.id === saved)) {
        this.storedTheme.set(saved);
      }
    });

    /*
      Apply the stored theme at reveal rather than at load. Both `revealed()` and
      `storedTheme()` are read here, so this fires on whichever happens last: a
      theme that arrives after the boot screen lifts still applies, and a reveal
      that waits on this source sees the value ready for it.
    */
    effect(() => {
      if (!this.boot.revealed()) return;
      const stored = this.storedTheme();
      if (stored) this.currentTheme.set(stored);
    });
  }

  /**
   * Dropdown writes here via explicit binding, which is also the save hook.
   *
   * Accepts undefined because the dropdown's `selectedId` is `model<string>()`
   * with no default, so its change event is typed `string | undefined` even
   * though every real selection carries an id.
   */
  protected chooseTheme(id: string | undefined): void {
    if (!id) return;
    this.userChose = true;
    this.currentTheme.set(id);
    this.storedTheme.set(id);
    void this.settings.save(SettingsStore.THEME, id);
  }
}
