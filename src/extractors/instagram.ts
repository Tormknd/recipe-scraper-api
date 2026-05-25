import { getCookiesPathForUrl, parseNetscapeCookies } from '../utils/cookies';
import { buildCookieHeader, filterCookiesForHostname } from '../utils/httpCookies';
import { extractInstagramShortcode } from '../utils/platform';
import { ExtractedComment, PlatformPostMetadata } from './types';

const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 Instagram/333.0.0.42.91';

const MEDIA_DOC_ID = '10015901848480474';

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function unescapeInstagramJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/** Extrait la légende depuis le HTML brut (og:description, JSON embarqué IG). */
export function extractCaptionFromInstagramHtml(html: string): string {
  const candidates: string[] = [];

  const ogPatterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  ];
  for (const re of ogPatterns) {
    const m = html.match(re);
    if (m?.[1] && m[1].length > 15) {
      candidates.push(decodeHtmlEntities(m[1].trim()));
    }
  }

  const accessibility = html.match(/"accessibility_caption"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (accessibility?.[1]) {
    candidates.push(unescapeInstagramJsonString(accessibility[1]).trim());
  }

  const captionNodes = html.matchAll(
    /"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g
  );
  for (const m of captionNodes) {
    if (m[1]) candidates.push(unescapeInstagramJsonString(m[1]).trim());
  }

  const genericTexts = html.matchAll(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/g);
  for (const m of genericTexts) {
    const t = unescapeInstagramJsonString(m[1]).trim();
    if (t.length >= 40 && /[a-zA-Zàâäéèêëïîôùûüç]{3}/i.test(t)) {
      candidates.push(t);
    }
  }

  const unique = [...new Set(candidates)].filter((t) => t.length >= 15);
  unique.sort((a, b) => b.length - a.length);
  return unique[0] || '';
}

function mergeInstagramMetadata(
  base: PlatformPostMetadata | null,
  patch: Partial<PlatformPostMetadata> & { source?: PlatformPostMetadata['source'] }
): PlatformPostMetadata {
  return {
    platform: 'instagram',
    description: (base?.description?.length ? base.description : patch.description) || '',
    title: base?.title || patch.title,
    comments: (base?.comments?.length ? base.comments : patch.comments) || [],
    videoDownloadUrl: base?.videoDownloadUrl || patch.videoDownloadUrl,
    videoId: base?.videoId || patch.videoId,
    source: base?.source || patch.source || 'embedded_json',
  };
}

function getInstagramCookieHeader(url: string): { cookieHeader: string; csrfToken: string } {
  const cookiesPath = getCookiesPathForUrl(url);
  const parsed = parseNetscapeCookies(cookiesPath);
  const hostname = new URL(url).hostname;
  const filtered = filterCookiesForHostname(parsed, hostname);
  const csrf = filtered.find((c) => c.name === 'csrftoken')?.value ?? '';
  return { cookieHeader: buildCookieHeader(filtered), csrfToken: csrf };
}

function normalizeReelUrl(url: string, shortcode: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return `https://www.instagram.com/reel/${shortcode}/`;
  } catch {
    return `https://www.instagram.com/reel/${shortcode}/`;
  }
}

async function fetchInstagramGraphQL(
  shortcode: string,
  reelUrl: string
): Promise<PlatformPostMetadata | null> {
  const { cookieHeader, csrfToken } = getInstagramCookieHeader(reelUrl);
  if (!cookieHeader.includes('sessionid=')) {
    console.warn('[Instagram] GraphQL skipped: no sessionid in cookies');
    return null;
  }

  const variables = JSON.stringify({
    shortcode,
    __relay_internal__pv__PolarisFeedShareMenurelayprovider: false,
  });

  const body = new URLSearchParams({
    variables,
    doc_id: MEDIA_DOC_ID,
  });

  const response = await fetch('https://www.instagram.com/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': INSTAGRAM_UA,
      'X-IG-App-ID': '936619743392459',
      'X-ASBD-ID': '198387',
      'X-CSRFToken': csrfToken,
      'X-Instagram-AJAX': '1013513786',
      Origin: 'https://www.instagram.com',
      Referer: reelUrl,
      Cookie: cookieHeader,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    console.warn(`[Instagram] GraphQL HTTP ${response.status}`);
    return null;
  }

  const json = (await response.json()) as {
    data?: {
      xdt_shortcode_media?: {
        id?: string;
        video_url?: string;
        edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
        edge_media_to_parent_comment?: {
          edges?: Array<{
            node?: {
              text?: string;
              edge_liked_by?: { count?: number };
              owner?: { username?: string };
            };
          }>;
        };
      };
    };
  };

  const media = json.data?.xdt_shortcode_media;
  if (!media) {
    console.warn('[Instagram] GraphQL: xdt_shortcode_media absent (doc_id obsolète ?)');
    return null;
  }

  const description =
    media.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() ?? '';

  const comments: ExtractedComment[] = (media.edge_media_to_parent_comment?.edges ?? [])
    .map((edge) => edge.node)
    .filter((node): node is NonNullable<typeof node> => Boolean(node?.text))
    .sort((a, b) => (b.edge_liked_by?.count ?? 0) - (a.edge_liked_by?.count ?? 0))
    .slice(0, 20)
    .map((node) => ({
      text: node.text!,
      author: node.owner?.username,
      likes: node.edge_liked_by?.count,
    }));

  console.log(
    `[Instagram] GraphQL: desc=${description.length} chars, comments=${comments.length}, video=${Boolean(media.video_url)}`
  );

  return {
    platform: 'instagram',
    description,
    comments,
    videoDownloadUrl: media.video_url,
    videoId: media.id,
    source: 'graphql',
  };
}

function parseFromLdJson(html: string): PlatformPostMetadata | null {
  const ldJsonMatches = html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  );
  for (const match of ldJsonMatches) {
    try {
      const ld = JSON.parse(match[1]) as {
        description?: string;
        caption?: string;
        name?: string;
      };
      const description = (ld.description || ld.caption || '').trim();
      if (description.length > 10) {
        return {
          platform: 'instagram',
          description,
          title: ld.name,
          comments: [],
          source: 'embedded_json',
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function extractInstagramPost(url: string): Promise<PlatformPostMetadata | null> {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return null;

  const reelUrl = normalizeReelUrl(url, shortcode);

  try {
    let merged: PlatformPostMetadata | null = await fetchInstagramGraphQL(shortcode, reelUrl);

    const { cookieHeader } = getInstagramCookieHeader(reelUrl);
    const pageResponse = await fetch(reelUrl, {
      headers: {
        'User-Agent': INSTAGRAM_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      signal: AbortSignal.timeout(25_000),
    });

    if (pageResponse.ok) {
      const html = await pageResponse.text();
      const fromLd = parseFromLdJson(html);
      const fromRaw = extractCaptionFromInstagramHtml(html);

      if (fromLd || fromRaw) {
        merged = mergeInstagramMetadata(merged, {
          description: fromLd?.description || fromRaw,
          title: fromLd?.title,
          source: fromLd ? 'embedded_json' : 'embedded_json',
        });
      }
    } else {
      console.warn(`[Instagram] Page HTML HTTP ${pageResponse.status}`);
    }

    if (!merged) return null;

    if (!merged.description.length) {
      console.warn(
        `[Instagram] Aucune légende extraite pour ${shortcode} — web_scraping sera vide (cookies / GraphQL)`
      );
    } else {
      console.log(`[Instagram] Légende OK: ${merged.description.length} chars (${merged.source})`);
    }

    return merged;
  } catch (error) {
    console.warn('[Instagram] Metadata extraction failed:', error);
    return null;
  }
}
