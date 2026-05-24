import { parseNetscapeCookies } from './cookies';

export interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
}

/** Cookies Netscape pertinents pour un hostname (ex. www.tiktok.com → .tiktok.com). */
export function filterCookiesForHostname(
  cookies: ParsedCookie[],
  hostname: string
): ParsedCookie[] {
  const host = hostname.toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);

  return cookies.filter((cookie) => {
    if (cookie.expires && cookie.expires < nowSec) return false;
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });
}

export function buildCookieHeader(cookies: ParsedCookie[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const cookie of cookies) {
    if (seen.has(cookie.name)) continue;
    seen.add(cookie.name);
    parts.push(`${cookie.name}=${cookie.value}`);
  }
  return parts.join('; ');
}

export function getCookieHeaderForUrl(url: string, cookiesFilePath: string): string {
  const parsed = parseNetscapeCookies(cookiesFilePath);
  const hostname = new URL(url).hostname;
  const filtered = filterCookiesForHostname(parsed, hostname);
  return buildCookieHeader(filtered);
}

const PLATFORM_DOMAIN_HINTS: Record<'tiktok' | 'instagram', string[]> = {
  tiktok: ['tiktok.com', 'tiktokw.eu'],
  instagram: ['instagram.com'],
};

function dedupeCookiesByName(cookies: ParsedCookie[]): ParsedCookie[] {
  const byKey = new Map<string, ParsedCookie>();
  for (const cookie of cookies) {
    const key = `${cookie.domain}|${cookie.name}`;
    const existing = byKey.get(key);
    if (!existing || (cookie.expires ?? 0) > (existing.expires ?? 0)) {
      byKey.set(key, cookie);
    }
  }
  return [...byKey.values()];
}

/** Garde uniquement les cookies des domaines de la plateforme (export navigateur pollué). */
export function filterCookiesForPlatform(
  cookies: ParsedCookie[],
  platform: 'tiktok' | 'instagram'
): ParsedCookie[] {
  const hints = PLATFORM_DOMAIN_HINTS[platform];
  const nowSec = Math.floor(Date.now() / 1000);

  const filtered = cookies.filter((cookie) => {
    if (cookie.expires && cookie.expires < nowSec) return false;
    const domain = cookie.domain.replace(/^\./, '').toLowerCase();
    return hints.some((hint) => domain === hint || domain.endsWith(`.${hint}`) || domain.endsWith(hint));
  });

  return dedupeCookiesByName(filtered);
}
