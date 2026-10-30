import { Component, signal } from '@angular/core';
import { ThemeDropdown } from '../../ui-elements/theme-dropdown/theme-dropdown';
import { THEMES } from '../themes';

@Component({
  selector: 'app-main-container',
  standalone: true,
  imports: [ThemeDropdown],
  templateUrl: './main-container.html',
  styleUrl: './main-container.scss',
})
export class MainContainer {
  protected readonly themes = THEMES;

  /** Single source of truth for the active theme, shared with the dropdown. */
  protected readonly currentTheme = signal('tokyo-night');
}
