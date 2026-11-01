import { buildContinuation, buildPrompt, PromptParts } from './prompt';

const parts = (over: Partial<PromptParts>): PromptParts => ({
  user: 'guest-1a2b',
  host: 'mpdev',
  cwd: '~',
  symbol: '❯',
  errorSymbol: '✗',
  failed: false,
  showIdentity: true,
  ...over,
});

describe('buildPrompt', () => {
  it('uses the success symbol when nothing has failed', () => {
    const segments = buildPrompt(parts({}));
    expect(segments.at(-1)?.text).toBe('❯ ');
  });

  it('swaps to the error symbol after a failed command', () => {
    const segments = buildPrompt(parts({ failed: true }));
    expect(segments.at(-1)?.text).toBe('✗ ');
  });

  it('keeps the same style for both, matching a config that colours them alike', () => {
    const success = buildPrompt(parts({})).at(-1);
    const failure = buildPrompt(parts({ failed: true })).at(-1);
    expect(failure?.classes).toBe(success?.classes);
  });

  it('dims the identity relative to the starship emphasis', () => {
    const segments = buildPrompt(parts({}));
    const identity = segments.find((segment) => segment.text.includes('@mpdev'));
    const character = segments.at(-1);
    expect(identity).toBeTruthy();
    expect(identity?.classes).not.toBe(character?.classes);
  });

  it('omits the identity entirely when asked', () => {
    const segments = buildPrompt(parts({ showIdentity: false }));
    expect(segments.some((segment) => segment.text.includes('@mpdev'))).toBe(false);
    expect(segments.length).toBe(2);
  });

  it('leaves a trailing space on every segment, since markup cannot carry it', () => {
    for (const segment of buildPrompt(parts({}))) {
      expect(segment.text.endsWith(' ')).toBe(true);
    }
  });
});

describe('buildContinuation', () => {
  it('renders PS2 unemphasised', () => {
    const segments = buildContinuation('>');
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('> ');
    expect(segments[0].classes).toContain('muted');
  });
});
