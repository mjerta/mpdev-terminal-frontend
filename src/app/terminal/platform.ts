/**
 * Best available answer to "what machine is this?", plus how much to trust it.
 *
 * Start with the hard limit: a browser cannot read a machine name. There is no
 * web API for a hostname or a device's user-chosen name, which is why `host`
 * used to be hardcoded. Anything produced here is therefore a proxy, ordered by
 * how close it gets to a real name:
 *
 * 1. `config.host` wins outright. This is where a backend belongs: an agent on
 *    the machine can report `os.hostname()` truthfully, and a browser never can.
 * 2. The UA-CH high-entropy `model`, which on Android really is the device name
 *    ("Pixel 7"). Chromium only.
 * 3. The UA-CH `platform` hint, or parsing the UA string for everything else.
 *
 * Honest limits on the fallbacks: Firefox and Safari do not expose `model` and
 * actively degrade UA strings to resist fingerprinting; desktop Chrome reports an
 * empty `model`; Chrome's UA reduction has flattened parts of these strings; and
 * Safari on iPad claims to be a Mac, which the touch-point probe below catches.
 *
 * So `source` exists so the UI can be truthful about confidence rather than
 * painting a guess as a fact.
 */
export interface PlatformHints {
  readonly userAgent: string;
  /** `navigator.platform`, deprecated but the only signal Firefox/Safari give. */
  readonly legacyPlatform: string;
  /** `navigator.userAgentData.platform`, present only in Chromium. */
  readonly clientHints?: string | null;
  readonly maxTouchPoints?: number;
  /** UA-CH high entropy `model`: the device name on Android. Chromium only. */
  readonly model?: string | null;
}

/** Where a label came from, ordered by how much it deserves to be trusted. */
export type ClientSource = 'model' | 'platform' | 'user-agent' | 'unknown';

export interface ClientIdentity {
  readonly label: string;
  readonly source: ClientSource;
}

/** Shape a hint into something a hostname-shaped prompt can carry. */
function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Lowercase device class from the UA string, for browsers with no client hints.
 *
 * Order matters and is the whole point of this function: Android's UA also says
 * "Linux", ChromeOS says "X11", and iPad Safari says "Macintosh", so the
 * specific platforms have to be tested before the generic Unix ones or several
 * devices collapse into one label.
 */
export function detectPlatform(hints: PlatformHints): string {
  const ua = hints.userAgent ?? '';

  if (hints.clientHints === 'Android' || /Android/i.test(ua)) return 'android';
  if (hints.clientHints === 'iPhone' || /iPhone|iPod/i.test(ua)) return 'iphone';
  if (hints.clientHints === 'iPad' || /iPad/i.test(ua)) return 'ipad';
  if (/CrOS/i.test(ua)) return 'chromebook';
  if (/Windows/i.test(ua)) return 'windows';

  // The iPad-as-Mac disguise: real Mac hardware has no multi-touch pointer, and
  // this only runs for strings that already look like a Mac, so a touchscreen
  // Windows laptop was already claimed above.
  if (/Macintosh|Mac OS X/i.test(ua) || hints.legacyPlatform === 'MacIntel') {
    return (hints.maxTouchPoints ?? 0) > 1 ? 'ipad' : 'mac';
  }

  if (/Linux|X11/i.test(ua) || /Linux/i.test(hints.legacyPlatform ?? '')) return 'linux';
  return 'unknown';
}

/** Pure so the ladder can be tested without a browser. */
export function describeClient(hints: PlatformHints): ClientIdentity {
  const model = slug(hints.model ?? '');
  if (model) return { label: model, source: 'model' };

  const platformHint = slug(hints.clientHints ?? '');
  if (platformHint) return { label: platformHint, source: 'platform' };

  const parsed = detectPlatform(hints);
  if (parsed !== 'unknown') return { label: parsed, source: 'user-agent' };

  return { label: 'unknown', source: 'unknown' };
}

/**
 * Read the hints off the live browser. High-entropy values are async by spec and
 * are only answered when the browser feels the page is trustworthy enough, so
 * every field degrades to null rather than failing.
 */
export async function readClientHints(): Promise<PlatformHints> {
  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
      getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }>;
    };
    maxTouchPoints?: number;
  };

  let model: string | null = null;
  try {
    // `platformVersion` is requested too because some engines only answer `model`
    // when the request is not a lone fingerprinting probe; the value is unused.
    model = (await nav.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']))?.model ?? null;
  } catch {
    model = null;
  }

  return {
    userAgent: nav.userAgent ?? '',
    legacyPlatform: nav.platform ?? '',
    clientHints: nav.userAgentData?.platform ?? null,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    model,
  };
}
