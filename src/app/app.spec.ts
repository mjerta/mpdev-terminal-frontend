import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the terminal with its prompt', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    // This app has no heading, so there is nothing here to assert about a title:
    // the scaffolded `should render title` test checked for an <h1> that never
    // existed and had been failing since before any of this UI was written. The
    // first thing on screen is the terminal prompt, so that is what matters.
    expect(compiled.querySelector('app-terminal')).toBeTruthy();

    // Only the static part of the prompt is asserted. The guest name and the
    // viewport height both arrive asynchronously and are unavailable under
    // jsdom, so asserting them would make this test depend on storage APIs.
    expect(compiled.querySelector('main p')?.textContent).toContain('@mpdev ~ ❯');
  });
});
