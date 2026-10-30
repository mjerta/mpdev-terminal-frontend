import { Component, computed, model, signal } from '@angular/core';
import { THEMES, Theme } from '../../framework/themes';

@Component({
  selector: 'app-theme-dropdown',
  imports: [],
  templateUrl: './theme-dropdown.html',
  styleUrl: './theme-dropdown.scss',
})
export class ThemeDropdown {
  protected readonly isOpen = signal(false);
  protected readonly themes = THEMES;

  /** Two-way bound by the host: [(selectedId)]="currentTheme" */
  readonly selectedId = model<string>();

  protected readonly currentThemeName = computed(
    () => this.themes.find((theme) => theme.id === this.selectedId())?.name ?? 'Select a theme',
  );

  protected selectTheme(theme: Theme): void {
    this.selectedId.set(theme.id);
    this.isOpen.set(false);
  }
}
