import { Component, inject, signal } from '@angular/core';
import { ThemeDropdown } from '../../ui-elements/theme-dropdown/theme-dropdown';
import { Card } from '../../ui-elements/card/card';
import { CardGrid } from '../../ui-elements/card-grid/card-grid';
import { SettingsStore } from '../../terminal/settings.store';
import { Terminal } from '../../terminal/terminal';
import { THEMES } from '../themes';

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
   * Starts at the default and is replaced by the stored choice once IndexedDB
   * answers. That read is asynchronous, so a saved theme can paint a frame late:
   * on a reload you may briefly see tokyo-night before your own theme applies.
   */
  protected readonly currentTheme = signal('tokyo-night');

  /** Flip to true to bring the theme preview wall back. */
  protected readonly showGallery = signal(false);

  private readonly settings = inject(SettingsStore);

  /** Set as soon as the user picks, so a slow load cannot overwrite their choice. */
  private userChose = false;

  constructor() {
    void this.settings.load<string>(SettingsStore.THEME).then((saved) => {
      if (this.userChose) return;
      // Ignore anything that is not a theme we still have, so a removed id from
      // an older visit cannot leave the app unstyled.
      if (saved && THEMES.some((theme) => theme.id === saved)) {
        this.currentTheme.set(saved);
      }
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
    void this.settings.save(SettingsStore.THEME, id);
  }
}
