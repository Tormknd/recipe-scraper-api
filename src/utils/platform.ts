export type SocialPlatform = 'tiktok' | 'instagram' | 'unknown';

export function isTikTokUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes('tiktok.com');
  } catch {
    return false;
  }
}

export function isInstagramUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes('instagram.com');
  } catch {
    return false;
  }
}

export function detectPlatform(url: string): SocialPlatform {
  if (isTikTokUrl(url)) return 'tiktok';
  if (isInstagramUrl(url)) return 'instagram';
  return 'unknown';
}

/** ID numérique TikTok depuis une URL canonique (@user/video/123…). */
export function extractTikTokVideoId(url: string): string | null {
  const match = url.match(/\/video\/(\d+)/);
  return match?.[1] ?? null;
}

/** Shortcode Instagram (reel, post, TV). */
export function extractInstagramShortcode(url: string): string | null {
  const match = url.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}
