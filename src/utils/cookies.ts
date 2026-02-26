import fs from 'fs';
import path from 'path';

/** Format Netscape : domain flag path secure expiration name value (tab-separated) */
export function parseNetscapeCookies(filePath: string): Array<{ name: string; value: string; domain: string; path: string; expires?: number; secure?: boolean }> {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const cookies: Array<{ name: string; value: string; domain: string; path: string; expires?: number; secure?: boolean }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;
    const [domain, , pathPart, secure, expiration, name, value] = parts;
    const expires = parseInt(expiration || '0', 10);
    cookies.push({
      name,
      value,
      domain: domain.trim(),
      path: pathPart?.trim() || '/',
      expires: expires > 0 ? expires : undefined,
      secure: secure?.toLowerCase() === 'true',
    });
  }
  return cookies;
}

export function isTikTokUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes('tiktok.com') || hostname.includes('vm.tiktok.com');
  } catch {
    return false;
  }
}

const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(process.cwd(), 'cookies.txt');
const COOKIES_TIKTOK_PATH = process.env.COOKIES_TIKTOK_PATH || path.resolve(process.cwd(), 'cookies-tiktok.txt');

export function getCookiesPathForUrl(url: string): string {
  if (isTikTokUrl(url) && fs.existsSync(COOKIES_TIKTOK_PATH)) {
    return COOKIES_TIKTOK_PATH;
  }
  return COOKIES_PATH;
}

/** Retourne les cookies Netscape parsés pour l’URL (Instagram ou TikTok). */
export function loadCookiesForUrl(url: string): Array<{ name: string; value: string; domain: string; path: string; expires?: number; secure?: boolean }> {
  const cookiesPath = getCookiesPathForUrl(url);
  return parseNetscapeCookies(cookiesPath);
}
