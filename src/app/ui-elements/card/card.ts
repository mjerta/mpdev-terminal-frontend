import { Component, input } from '@angular/core';

/**
 * A generic bordered box. It knows nothing about what it renders: feed it text
 * props and project whatever body/action content you need.
 *
 * Optionally pass `theme` to scope a palette to the card and everything inside it.
 */
@Component({
  selector: 'app-card',
  imports: [],
  templateUrl: './card.html',
  styleUrl: './card.scss',
})
export class Card {
  readonly title = input<string>();
  readonly subtitle = input<string>();
  /** A `[data-theme]` value, e.g. 'dracula'. Leaves the card on the inherited theme when unset. */
  readonly theme = input<string>();
}
