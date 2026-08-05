import { Component } from '@angular/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faPalette } from '@fortawesome/free-solid-svg-icons';
@Component({
  selector: 'app-main-container',
  standalone: true,
  imports: [FontAwesomeModule],
  templateUrl: './main-container.html',
  styleUrl: './main-container.scss',
})
export class MainContainer {
  isOpen: boolean = false;
  currentTheme: string = 'tokyo-night';
  faPalette = faPalette;
}
