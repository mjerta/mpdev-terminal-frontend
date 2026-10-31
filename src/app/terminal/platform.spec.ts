import { PlatformHints, detectPlatform, describeClient } from './platform';

const hints = (over: Partial<PlatformHints>): PlatformHints => ({
  userAgent: '',
  legacyPlatform: '',
  clientHints: null,
  maxTouchPoints: 0,
  model: null,
  ...over,
});

/**
 * Table test over real UA strings. The interesting cases are all about order:
 * Android's UA contains "Linux", ChromeOS contains "X11", and Safari on iPad
 * claims to be a Mac, so a naive check would collapse several devices into one.
 */
describe('detectPlatform', () => {
  const androidUa =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
  const iphoneUa =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const ipadUa =
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const macSafariUa =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const windowsUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
  const linuxFirefoxUa = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
  const crosUa =
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

  const cases: Array<[string, PlatformHints, string]> = [
    ['Android phone with client hints', hints({ userAgent: androidUa, legacyPlatform: 'Linux armv8l', clientHints: 'Android', maxTouchPoints: 5 }), 'android'],
    ['Android phone without client hints (Firefox on Android)', hints({ userAgent: androidUa, legacyPlatform: 'Linux armv8l', maxTouchPoints: 5 }), 'android'],
    ['iPhone Safari', hints({ userAgent: iphoneUa, legacyPlatform: 'iPhone', maxTouchPoints: 5 }), 'iphone'],
    ['iPad Safari, honest UA', hints({ userAgent: ipadUa, legacyPlatform: 'iPad', maxTouchPoints: 5 }), 'ipad'],
    ['iPad in its Mac disguise (Mac UA + touch)', hints({ userAgent: macSafariUa, legacyPlatform: 'MacIntel', maxTouchPoints: 5 }), 'ipad'],
    ['Real Mac Safari (no touch)', hints({ userAgent: macSafariUa, legacyPlatform: 'MacIntel' }), 'mac'],
    ['Mac Firefox', hints({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0', legacyPlatform: 'MacIntel' }), 'mac'],
    ['Windows desktop', hints({ userAgent: windowsUa, legacyPlatform: 'Win32' }), 'windows'],
    ['Windows touchscreen laptop stays windows', hints({ userAgent: windowsUa, legacyPlatform: 'Win32', maxTouchPoints: 10 }), 'windows'],
    ['Linux desktop Firefox', hints({ userAgent: linuxFirefoxUa, legacyPlatform: 'Linux x86_64' }), 'linux'],
    ['ChromeOS', hints({ userAgent: crosUa, legacyPlatform: 'Linux x86_64' }), 'chromebook'],
    ['Nothing recognisable', hints({}), 'unknown'],
  ];

  for (const [label, input, expected] of cases) {
    it(`identifies ${label} as ${expected}`, () => {
      expect(detectPlatform(input)).toBe(expected);
    });
  }

  it('lets client hints override a contradictory UA', () => {
    expect(detectPlatform(hints({ userAgent: linuxFirefoxUa, legacyPlatform: 'Linux x86_64', clientHints: 'Android' }))).toBe('android');
  });

  it('tolerates a missing userAgent', () => {
    expect(() => detectPlatform({ userAgent: undefined as unknown as string, legacyPlatform: '' })).not.toThrow();
  });
});

/** The ladder is the part that answers "machine name", so it needs its own table. */
describe('describeClient', () => {
  const pixel: PlatformHints = {
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
    legacyPlatform: 'Linux armv8l',
    clientHints: 'Android',
    maxTouchPoints: 5,
    model: 'Pixel 7',
  };

  it('prefers the device model, slugged into a hostname shape', () => {
    expect(describeClient(pixel)).toEqual({ label: 'pixel-7', source: 'model' });
  });

  it('keeps word order and drops punctuation', () => {
    expect(describeClient({ ...pixel, model: 'SM-A546B' }).label).toBe('sm-a546b');
    expect(describeClient({ ...pixel, model: 'Galaxy S23 Ultra' }).label).toBe('galaxy-s23-ultra');
  });

  it('falls back to the platform hint when there is no model', () => {
    // Desktop Chrome answers `model` as an empty string.
    expect(describeClient(hints({ clientHints: 'Windows', userAgent: windowsDesktop() }))).toEqual({
      label: 'windows',
      source: 'platform',
    });
  });

  it('falls back to the UA guess when a browser withholds every hint', () => {
    const firefoxLinux: PlatformHints = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
      legacyPlatform: 'Linux x86_64',
      clientHints: null,
      maxTouchPoints: 0,
      model: null,
    };
    expect(describeClient(firefoxLinux)).toEqual({ label: 'linux', source: 'user-agent' });
  });

  it('says unknown rather than inventing something', () => {
    expect(describeClient(hints({}))).toEqual({ label: 'unknown', source: 'unknown' });
  });

  it('treats a whitespace-only model as absent', () => {
    expect(describeClient(hints({ model: '   ', clientHints: 'Linux', userAgent: windowsDesktop() })).source).toBe('platform');
  });
});

function windowsDesktop(): string {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
}
