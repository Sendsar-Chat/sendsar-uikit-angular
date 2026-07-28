const NOTO_LOTTIE_BASE = 'https://fonts.gstatic.com/s/e/notoemoji/latest';
const NOTO_INDEX_URL = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';

const availabilityCache = new Map<string, boolean>();
let notoIndexPromise: Promise<Set<string> | null> | null = null;

/** Convert an emoji grapheme to Noto's codepoint key (e.g. "1f979"). */
export function emojiToCodepointKey(emoji: string): string {
  const codePoints: number[] = [];
  for (const char of emoji) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined) {
      codePoints.push(codePoint);
    }
  }
  return codePoints.map((codePoint) => codePoint.toString(16)).join('_');
}

/** Lottie JSON URL for a Noto animated emoji (see https://googlefonts.github.io/noto-emoji-animation/). */
export function notoLottieUrl(emoji: string): string {
  return `${NOTO_LOTTIE_BASE}/${emojiToCodepointKey(emoji)}/lottie.json`;
}

async function loadNotoAnimationIndex(): Promise<Set<string> | null> {
  if (!notoIndexPromise) {
    notoIndexPromise = fetch(NOTO_INDEX_URL)
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const data = (await response.json()) as {
          icons?: Array<{ codepoint?: string }>;
        };

        return new Set(
          (data.icons ?? [])
            .map((icon) => icon.codepoint?.toLowerCase())
            .filter((codepoint): codepoint is string => Boolean(codepoint)),
        );
      })
      .catch(() => null);
  }

  return notoIndexPromise;
}

/** Check whether Google hosts an animation for this emoji (cached). */
export async function hasNotoAnimation(emoji: string): Promise<boolean> {
  const key = emojiToCodepointKey(emoji);
  const cached = availabilityCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const notoIndex = await loadNotoAnimationIndex();
  if (notoIndex) {
    const available = notoIndex.has(key);
    availabilityCache.set(key, available);
    return available;
  }

  try {
    const response = await fetch(notoLottieUrl(emoji), { method: 'HEAD' });
    const available = response.ok;
    availabilityCache.set(key, available);
    return available;
  } catch {
    availabilityCache.set(key, false);
    return false;
  }
}
