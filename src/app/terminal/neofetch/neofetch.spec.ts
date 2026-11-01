import { ComponentFixture, TestBed } from '@angular/core/testing';

import { formatUptime, Neofetch } from './neofetch';
import { FICTIONAL_TERMINAL } from '../terminal.config';

describe('Neofetch', () => {
  let fixture: ComponentFixture<Neofetch>;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const rows = (): HTMLElement[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.row'));
  const valueFor = (label: string): string | undefined =>
    rows()
      .find((row) => row.querySelector('dt')?.textContent?.trim() === label)
      ?.querySelector('dd')
      ?.textContent?.trim();

  /** Inputs have to be set before the first change detection: the report is a snapshot. */
  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(Neofetch);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Neofetch] });
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('prints the logo as a rectangular block', () => {
    /*
      Not cosmetic. The stylesheet sizes the art as 48 columns against the
      container, so a row that is short would leave the logo floating and a row
      that is long would be clipped on a phone. This is the invariant that makes
      the scaling maths valid.
    */
    render();
    const art = (fixture.nativeElement as HTMLElement).querySelector('pre')?.textContent ?? '';
    const lines = art.split('\n');

    expect(lines).toHaveLength(6);
    expect(new Set(lines.map((line) => [...line].length))).toEqual(new Set([48]));
    // Still the name, not just a rectangle: every letter has to be represented.
    expect(art).toContain('╚═╝');
  });

  it('hides the logo from assistive tech, which already hears the host name', () => {
    render();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('pre')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('takes the machine details from the config map', () => {
    render();
    expect(valueFor('OS')).toBe(FICTIONAL_TERMINAL.system.os);
    expect(valueFor('Host')).toBe(FICTIONAL_TERMINAL.host);
    expect(valueFor('Kernel')).toBe(FICTIONAL_TERMINAL.system.kernel);
    expect(valueFor('Shell')).toBe(FICTIONAL_TERMINAL.shell);
    expect(valueFor('Terminal')).toBe(FICTIONAL_TERMINAL.system.terminal);
  });

  it('names the visitor exactly as the prompt does', () => {
    render({ user: 'guest-x32a' });
    expect(text()).toContain('guest-x32a@mpdev');
  });

  it('reports the live values it was handed', () => {
    render({ theme: 'dracula', uptimeMs: 125_000, commands: 7 });

    expect(valueFor('Theme')).toBe('dracula');
    expect(valueFor('Uptime')).toBe('2m 5s');
    expect(valueFor('Commands')).toBe('7');
  });

  it('shortens the font stack to the family that is actually drawn', () => {
    render();
    // Quoted CSS declaration, first family only: the full stack wraps to three
    // lines on a phone and says nothing the first entry does not.
    expect(valueFor('Font')).toBe('JetBrainsMono Nerd Font');
  });

  it('reports a real resolution rather than an empty one', () => {
    render();
    expect(valueFor('Resolution')).toMatch(/^\d+x\d+$/);
    expect(valueFor('Resolution')).not.toBe('0x0');
  });

  it('freezes the report at the moment it was printed', () => {
    /*
      A report is a snapshot. If a later `neofetch` runs, or the theme changes, an
      older block must keep saying what it said - otherwise scrolling back would
      show today's numbers under yesterday's logo.
    */
    render({ theme: 'nord', uptimeMs: 1_000, commands: 3 });
    expect(valueFor('Theme')).toBe('nord');

    fixture.componentRef.setInput('theme', 'dracula');
    fixture.componentRef.setInput('uptimeMs', 900_000);
    fixture.componentRef.setInput('commands', 42);
    fixture.detectChanges();

    expect(valueFor('Theme')).toBe('nord');
    expect(valueFor('Uptime')).toBe('1s');
    expect(valueFor('Commands')).toBe('3');
  });
});

describe('formatUptime', () => {
  it('counts seconds while the session is under a minute', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(4_000)).toBe('4s');
    expect(formatUptime(59_999)).toBe('59s');
  });

  it('switches to minutes and seconds at a minute', () => {
    expect(formatUptime(60_000)).toBe('1m 0s');
    expect(formatUptime(125_000)).toBe('2m 5s');
    expect(formatUptime(3_599_000)).toBe('59m 59s');
  });

  it('drops seconds once there are hours to report', () => {
    expect(formatUptime(3_600_000)).toBe('1h 0m');
    expect(formatUptime(7_500_000)).toBe('2h 5m');
  });

  it('never reports negative time', () => {
    expect(formatUptime(-5_000)).toBe('0s');
  });
});
