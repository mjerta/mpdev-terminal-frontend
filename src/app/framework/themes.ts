export interface Theme {
  id: string;
  name: string;
}

/**
 * Single source of truth for the theme list.
 * `id` must match a `[data-theme='...']` block in src/assets/styles/themes.scss.
 */
export const THEMES: readonly Theme[] = [
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
