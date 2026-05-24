import fs from 'fs';
import path from 'path';
import { detectPlatform, isTikTokUrl } from './platform';
import {
  filterCookiesForHostname,
  filterCookiesForPlatform,
  ParsedCookie,
} from './httpCookies';

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

export { isTikTokUrl, isInstagramUrl, detectPlatform } from './platform';

const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(process.cwd(), 'cookies.txt');
const COOKIES_TIKTOK_PATH = process.env.COOKIES_TIKTOK_PATH || path.resolve(process.cwd(), 'cookies-tiktok.txt');

export function getCookiesPathForUrl(url: string): string {
  if (isTikTokUrl(url) && fs.existsSync(COOKIES_TIKTOK_PATH)) {
    return COOKIES_TIKTOK_PATH;
  }
  return COOKIES_PATH;
}

export function serializeNetscapeCookies(cookies: ParsedCookie[]): string {
  const header =
    '# Netscape HTTP Cookie File\n# Filtré par recipe-scraper-api\n';
  const lines = cookies.map((cookie) => {
    const domain = cookie.domain;
    const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const expiration =
      cookie.expires && cookie.expires > 0
        ? cookie.expires
        : Math.floor(Date.now() / 1000) + 86400 * 365;
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    return `${domain}\t${includeSubdomains}\t${cookie.path}\t${secure}\t${expiration}\t${cookie.name}\t${cookie.value}`;
  });
  return `${header}${lines.join('\n')}\n`;
}

/**
 * Écrit un fichier Netscape temporaire avec uniquement les cookies utiles pour l'URL.
 * Évite d'envoyer 6000 lignes à yt-dlp.
 */
export function writeFilteredCookiesForUrl(
  sourcePath: string,
  destPath: string,
  url: string
): number {
  const parsed = parseNetscapeCookies(sourcePath);
  const platform = detectPlatform(url);
  const hostname = new URL(url).hostname;

  const filtered =
    platform === 'unknown'
      ? filterCookiesForHostname(parsed, hostname)
      : filterCookiesForPlatform(parsed, platform);

  fs.writeFileSync(destPath, serializeNetscapeCookies(filtered), 'utf-8');
  console.log(
    `[Cookies] Filtre ${sourcePath}: ${parsed.length} → ${filtered.length} entrées pour ${platform} (${hostname})`
  );
  return filtered.length;
}

/** Retourne les cookies parsés et filtrés pour la plateforme de l'URL. */
export function loadCookiesForUrl(url: string): ParsedCookie[] {
  const cookiesPath = getCookiesPathForUrl(url);
  const parsed = parseNetscapeCookies(cookiesPath);
  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    return filterCookiesForHostname(parsed, new URL(url).hostname);
  }
  return filterCookiesForPlatform(parsed, platform);
}
