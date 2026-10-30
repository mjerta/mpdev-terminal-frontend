import { Component, signal } from '@angular/core';
import { ThemeDropdown } from '../../ui-elements/theme-dropdown/theme-dropdown';
import { Card } from '../../ui-elements/card/card';
import { CardGrid } from '../../ui-elements/card-grid/card-grid';
import { THEMES } from '../themes';

@Component({
  selector: 'app-main-container',
  standalone: true,
  imports: [ThemeDropdown, Card, CardGrid],
  templateUrl: './main-container.html',
  styleUrl: './main-container.scss',
})
export class MainContainer {
  protected readonly themes = THEMES;

  /** Single source of truth for the active theme, shared with the dropdown. */
  protected readonly currentTheme = signal('tokyo-night');

  /** Flip to true to bring the theme preview wall back. */
  protected readonly showGallery = signal(false);
}
