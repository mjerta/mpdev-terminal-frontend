import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MainContainer } from './framework/main-container/main-container';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MainContainer],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('mpdev-terminal-frontend');
}
