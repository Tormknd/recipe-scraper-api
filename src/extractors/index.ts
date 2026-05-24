import { detectPlatform } from '../utils/platform';
import { extractInstagramPost } from './instagram';
import { extractTikTokPost } from './tiktok';
import { PlatformPostMetadata } from './types';

export type { PlatformPostMetadata, ExtractedComment } from './types';

export async function extractPostMetadata(url: string): Promise<PlatformPostMetadata | null> {
  const platform = detectPlatform(url);
  if (platform === 'tiktok') return extractTikTokPost(url);
  if (platform === 'instagram') return extractInstagramPost(url);
  return null;
}

export function metadataToScrapedText(meta: PlatformPostMetadata): string {
  const commentBlock =
    meta.comments.length > 0
      ? meta.comments.map((c) => `- ${c.author ? `@${c.author}: ` : ''}${c.text}`).join('\n')
      : '(aucun)';

  return `
DESCRIPTION_FULL (API / JSON embarqué — prioritaire):
${meta.description || '(vide)'}

VIDEO_CDN_URL (si disponible):
${meta.videoDownloadUrl ?? '(non extrait)'}

USER_COMMENTS (top ${meta.comments.length}):
${commentBlock}
`.trim();
}
