import { Component } from '@angular/core';

/**
 * Responsive card wall. Everything projected into it becomes a grid item and the
 * columns reflow to fit the available width with no explicit breakpoints.
 *
 * <app-card-grid>
 *   @for (item of items; track item.id) { <app-card ... /> }
 * </app-card-grid>
 */
@Component({
  selector: 'app-card-grid',
  imports: [],
  templateUrl: './card-grid.html',
  styleUrl: './card-grid.scss',
})
export class CardGrid {}
