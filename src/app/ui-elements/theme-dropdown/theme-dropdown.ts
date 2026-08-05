import { Component, output, signal } from '@angular/core';

@Component({
  selector: 'app-theme-dropdown',
  imports: [],
  templateUrl: './theme-dropdown.html',
  styleUrl: './theme-dropdown.scss',
})
export class ThemeDropdown {
  isOpen = signal(false);
  selectedId = 'gruvbox';
  currentThemeName = signal('Gruvbox');

  themeChange = output<string>();

  themes = [
    { id: 'catppuccin', name: 'Catppuccin Mocha' },
    { id: 'tokyo-night', name: 'Tokyo Night' },
    { id: 'dracula', name: 'Dracula' },
    { id: 'one-dark', name: 'One Dark' },
    { id: 'nord', name: 'Nord' },
    { id: 'kanagawa', name: 'Kanagawa' },
    { id: 'gruvbox', name: 'Gruvbox' },
    { id: 'ayu', name: 'Ayu Dark' },
    { id: 'rose-pine', name: 'Rosé Pine' },
    { id: 'solarized', name: 'Solarized Dark' },
  ];

  selectTheme(theme: { id: string; name: string }) {
    this.selectedId = theme.id;
    this.currentThemeName.set(theme.name);
    this.themeChange.emit(theme.id);
    this.isOpen.set(false);
  }
}
