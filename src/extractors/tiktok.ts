import { getCookiesPathForUrl, parseNetscapeCookies } from '../utils/cookies';
import { buildCookieHeader, filterCookiesForHostname } from '../utils/httpCookies';
import { extractTikTokVideoId } from '../utils/platform';
import { ExtractedComment, PlatformPostMetadata } from './types';

const TIKTOK_WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface TikTokItemStruct {
  id?: string;
  desc?: string;
  video?: {
    downloadAddr?: string;
    playAddr?: string | { url_list?: string[] };
  };
  author?: { uniqueId?: string; nickname?: string };
}

function getTikTokCookieHeader(url: string): string {
  const cookiesPath = getCookiesPathForUrl(url);
  const parsed = parseNetscapeCookies(cookiesPath);
  const hostname = new URL(url).hostname;
  return buildCookieHeader(filterCookiesForHostname(parsed, hostname));
}

/** Suit les redirections vm.tiktok.com / vt.tiktok.com vers l’URL canonique. */
export async function resolveTikTokUrl(url: string): Promise<string> {
  const cookieHeader = getTikTokCookieHeader(url);
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': TIKTOK_WEB_UA,
      Accept: 'text/html,application/xhtml+xml',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  return response.url || url;
}

function parseItemStructFromHtml(html: string): TikTokItemStruct | null {
  const universalMatch = html.match(
    /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i
  );
  if (universalMatch?.[1]) {
    try {
      const data = JSON.parse(universalMatch[1]) as Record<string, unknown>;
      const scope = data['__DEFAULT_SCOPE__'] as Record<string, unknown> | undefined;
      const detail = scope?.['webapp.video-detail'] as Record<string, unknown> | undefined;
      const itemInfo = detail?.itemInfo as Record<string, unknown> | undefined;
      const itemStruct = itemInfo?.itemStruct as TikTokItemStruct | undefined;
      if (itemStruct?.id || itemStruct?.desc) return itemStruct;
    } catch {
      // fallback SIGI
    }
  }

  const sigiMatch = html.match(/<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i);
  if (sigiMatch?.[1]) {
    try {
      const sigi = JSON.parse(sigiMatch[1]) as {
        ItemModule?: Record<string, TikTokItemStruct>;
      };
      const modules = sigi.ItemModule;
      if (modules) {
        const first = Object.values(modules)[0];
        if (first) return first;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getVideoDownloadUrl(item: TikTokItemStruct): string | undefined {
  const video = item.video;
  if (!video) return undefined;

  if (typeof video.downloadAddr === 'string' && video.downloadAddr.startsWith('http')) {
    return video.downloadAddr;
  }

  const playAddr = video.playAddr;
  if (typeof playAddr === 'string' && playAddr.startsWith('http')) return playAddr;
  if (playAddr && typeof playAddr === 'object' && playAddr.url_list?.[0]) {
    return playAddr.url_list[0];
  }

  return undefined;
}

async function fetchTikTokComments(
  videoId: string,
  pageUrl: string,
  cookieHeader: string
): Promise<ExtractedComment[]> {
  const params = new URLSearchParams({
    aweme_id: videoId,
    count: '20',
    cursor: '0',
    aid: '1988',
    app_name: 'tiktok_web',
    device_platform: 'web_pc',
  });

  const apiUrl = `https://www.tiktok.com/api/comment/list/?${params.toString()}`;
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': TIKTOK_WEB_UA,
      Accept: 'application/json',
      Referer: pageUrl,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return [];

  const body = (await response.json()) as {
    comments?: Array<{
      text?: string;
      digg_count?: number;
      user?: { unique_id?: string };
      is_author_digged?: boolean;
    }>;
  };

  return (body.comments ?? [])
    .filter((c) => c.text && c.text.length > 2)
    .sort((a, b) => (b.digg_count ?? 0) - (a.digg_count ?? 0))
    .slice(0, 20)
    .map((c) => ({
      text: c.text!,
      author: c.user?.unique_id,
      likes: c.digg_count,
    }));
}

export async function extractTikTokPost(url: string): Promise<PlatformPostMetadata | null> {
  try {
    const canonicalUrl = await resolveTikTokUrl(url);
    const videoId = extractTikTokVideoId(canonicalUrl);
    const cookieHeader = getTikTokCookieHeader(canonicalUrl);

    const pageResponse = await fetch(canonicalUrl, {
      headers: {
        'User-Agent': TIKTOK_WEB_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!pageResponse.ok) {
      console.warn(`[TikTok] Page fetch HTTP ${pageResponse.status} for ${canonicalUrl}`);
      return null;
    }

    const html = await pageResponse.text();
    const item = parseItemStructFromHtml(html);
    if (!item) {
      console.warn('[TikTok] No embedded itemStruct in page HTML');
      return null;
    }

    const resolvedVideoId = item.id ?? videoId ?? undefined;
    const comments = resolvedVideoId
      ? await fetchTikTokComments(resolvedVideoId, canonicalUrl, cookieHeader)
      : [];

    const author = item.author?.uniqueId || item.author?.nickname;
    const description = item.desc?.trim() || '';

    return {
      platform: 'tiktok',
      description,
      title: author ? `@${author}` : undefined,
      comments,
      videoDownloadUrl: getVideoDownloadUrl(item),
      videoId: resolvedVideoId,
      source: 'embedded_json',
    };
  } catch (error) {
    console.warn('[TikTok] Metadata extraction failed:', error);
    return null;
  }
}
