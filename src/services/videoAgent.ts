import { GoogleGenerativeAI } from '@google/generative-ai';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { extractTikTokPost, resolveTikTokUrl } from '../extractors/tiktok';
import { Recipe, UsageMetrics } from '../types';
import { getCookiesPathForUrl, writeFilteredCookiesForUrl } from '../utils/cookies';
import { buildVideoExtractionPrompt } from '../utils/geminiPrompt';
import { ScrapedComment } from '../types';
import { extractPostMetadata } from '../extractors';
import { getCookieHeaderForUrl } from '../utils/httpCookies';
import { isTikTokUrl } from '../utils/platform';
import dotenv from 'dotenv';

dotenv.config();

const execPromise = promisify(exec);

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error('GEMINI_API_KEY is required for video processing');
}

const genAI = new GoogleGenerativeAI(API_KEY);
const MODEL_NAME = 'gemini-flash-latest';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function downloadVideoFromCdn(
  downloadUrl: string,
  outputPath: string,
  refererUrl: string,
  cookiesPath: string
): Promise<boolean> {
  const cookieHeader = getCookieHeaderForUrl(refererUrl, cookiesPath);
  const response = await fetch(downloadUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: refererUrl,
      Accept: '*/*',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    console.warn(`[Video] CDN download HTTP ${response.status}`);
    return false;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) return false;
  fs.writeFileSync(outputPath, buffer);
  return true;
}

async function tryTikTokDirectDownload(url: string, outputPath: string): Promise<boolean> {
  const cookiesPath = getCookiesPathForUrl(url);
  if (!fs.existsSync(cookiesPath)) return false;

  try {
    const canonicalUrl = await resolveTikTokUrl(url);
    const metadata = await extractTikTokPost(url);
    const downloadUrl = metadata?.videoDownloadUrl;
    if (!downloadUrl) return false;

    console.log('[Video] TikTok CDN direct download (embedded JSON URL)...');
    const ok = await downloadVideoFromCdn(downloadUrl, outputPath, canonicalUrl, cookiesPath);
    if (ok && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      const sizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
      console.log(`✅ Video downloaded via TikTok CDN: ${sizeMB}MB`);
      return true;
    }
  } catch (error) {
    console.warn('[Video] TikTok direct download failed:', error);
  }
  return false;
}

async function downloadVideo(url: string, outputFilename: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const outputPath = path.resolve(tmpDir, outputFilename);
  const cookiesPath = getCookiesPathForUrl(url);
  const platform = isTikTokUrl(url) ? 'TikTok' : 'Instagram';

  // Copier les cookies vers un fichier temporaire inscriptible
  // (yt-dlp essaie de mettre à jour les cookies à la fin, ce qui échoue si le fichier est en lecture seule)
  let cookiesArg = '';
  let tempCookiesPath: string | null = null;

  if (fs.existsSync(cookiesPath)) {
    tempCookiesPath = path.join(tmpDir, `cookies_${Date.now()}.txt`);
    try {
      const count = writeFilteredCookiesForUrl(cookiesPath, tempCookiesPath, url);
      if (count === 0) {
        console.warn(`⚠️ Aucun cookie ${platform} valide après filtrage — vérifiez cookies-tiktok.txt`);
      }
      cookiesArg = `--cookies "${tempCookiesPath}"`;
      console.log(`🍪 Using ${count} filtered cookies for ${platform} (yt-dlp)`);
    } catch (copyError) {
      console.warn(`⚠️ Failed to write filtered cookies: ${copyError}`);
      cookiesArg = `--cookies "${cookiesPath}"`;
      console.log(`🍪 Fallback cookies path: ${cookiesPath}`);
    }
  } else {
    console.warn(`⚠️ No cookies file at ${cookiesPath} - ${platform} may block requests from datacenter IP. For TikTok, export cookies from tiktok.com (see README).`);
  }

  if (isTikTokUrl(url)) {
    const directOk = await tryTikTokDirectDownload(url, outputPath);
    if (directOk) {
      if (tempCookiesPath && fs.existsSync(tempCookiesPath)) {
        try {
          fs.unlinkSync(tempCookiesPath);
        } catch {
          /* ignore */
        }
      }
      return outputPath;
    }
  }

  const tiktokExtraArgs = isTikTokUrl(url)
    ? '--extractor-args "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com" '
    : '';

  const strategies = [
    {
      name: '720p optimized',
      command: `yt-dlp ${tiktokExtraArgs}-f "bestvideo[height<=720]+bestaudio/best[height<=720]" --user-agent "${USER_AGENT}" ${cookiesArg} --force-overwrites --no-warnings -o "${outputPath}" "${url}"`
    },
    {
      name: '720p MP4 fallback',
      command: `yt-dlp -f "best[height<=720][ext=mp4]/best[height<=720]" --user-agent "${USER_AGENT}" ${cookiesArg} --force-overwrites --no-warnings -o "${outputPath}" "${url}"`
    },
    {
      name: 'best quality (720p limit)',
      command: `yt-dlp -f "best[height<=720]/best" --user-agent "${USER_AGENT}" ${cookiesArg} --force-overwrites --no-warnings -o "${outputPath}" "${url}"`
    },
    {
      name: 'any format',
      command: `yt-dlp -f "best" --user-agent "${USER_AGENT}" ${cookiesArg} --force-overwrites --no-warnings -o "${outputPath}" "${url}"`
    }
  ];
  
  for (const strategy of strategies) {
    try {
      console.log(`🎥 Downloading (${strategy.name})...`);
      await execPromise(strategy.command, { 
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000
      });
      
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          console.log(`✅ Video downloaded: ${sizeMB}MB (${strategy.name})`);
          return outputPath;
        } else {
          console.warn(`⚠️ Downloaded file is empty, trying next strategy...`);
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
          continue;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      const fullError = error.stderr || error.stdout || errorMsg;
      
      // Vérifier si le fichier a été téléchargé malgré l'erreur
      // (yt-dlp peut échouer à la fin en essayant de sauvegarder les cookies, mais la vidéo est là)
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          console.log(`✅ Video downloaded successfully: ${sizeMB}MB (despite error at end - likely cookie save issue)`);
          // Nettoyer le fichier cookies temporaire avant de retourner
          if (tempCookiesPath && fs.existsSync(tempCookiesPath)) {
            try {
              fs.unlinkSync(tempCookiesPath);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
          return outputPath;
        }
      }
      
      console.warn(`⚠️ Strategy "${strategy.name}" failed: ${errorMsg.substring(0, 150)}`);
      
      // Log plus détaillé pour debug
      if (fullError.includes('429') || fullError.includes('Too Many Requests')) {
        console.error(`❌ Rate limit (429) - IP bloquée. ${isTikTokUrl(url) ? 'Pour TikTok, utilisez des cookies exportés depuis tiktok.com (COOKIES_TIKTOK_PATH).' : 'Vérifiez les cookies Instagram.'}`);
      } else if (fullError.includes('401') || fullError.includes('Unauthorized') || fullError.includes('Login') || fullError.includes('private') || fullError.includes('Log in')) {
        console.error(`❌ Accès refusé / login requis. Les cookies sont par domaine : pour TikTok, exportez depuis tiktok.com (fichier cookies-tiktok.txt ou COOKIES_TIKTOK_PATH).`);
      } else if (fullError.includes('Read-only file system') || fullError.includes('OSError: [Errno 30]')) {
        console.warn('⚠️ Cookie save error (read-only) - but download may have succeeded, checking file...');
      }
      
      if (fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      continue;
    }
  }
  
  // Nettoyer le fichier cookies temporaire
  if (tempCookiesPath && fs.existsSync(tempCookiesPath)) {
    try {
      fs.unlinkSync(tempCookiesPath);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
  
  const cookiesUsed = fs.existsSync(cookiesPath);
  const hint = isTikTokUrl(url)
    ? (cookiesUsed ? ' Les cookies Instagram ne marchent pas pour TikTok : exportez depuis tiktok.com (cookies-tiktok.txt ou COOKIES_TIKTOK_PATH).' : ' Pour TikTok, ajoutez des cookies exportés depuis tiktok.com.')
    : ' (cookies optionnels pour Instagram en datacenter).';
  throw new Error(`Impossible de télécharger la vidéo${cookiesUsed ? '' : ' (pas de cookies)'}.${hint} Vérifiez les logs ci-dessus.`);
}

export interface VideoExtractionContext {
  postDescription?: string;
  structuredComments?: ScrapedComment[];
}

export async function processVideoRecipe(
  url: string,
  onProgress?: (stage: string, message: string, percentage: number) => void,
  context?: VideoExtractionContext
): Promise<{ recipe: Recipe; usage?: UsageMetrics } | null> {
  const timestamp = Date.now();
  const tempFilename = `recipe_${timestamp}.mp4`;
  let localPath: string | null = null;

  try {
    if (onProgress) {
      onProgress('video_download', 'Téléchargement de la vidéo...', 50);
    }
    localPath = await downloadVideo(url, tempFilename);
    
    if (onProgress) {
      onProgress('video_analysis', 'Analyse du flux audio...', 70);
    }

    const fileBuffer = fs.readFileSync(localPath);
    const fileBase64 = fileBuffer.toString('base64');
    const fileSizeMB = fileBuffer.length / (1024 * 1024);
    
    if (fileSizeMB > 20) {
      console.warn(`⚠️ Video file is large (${fileSizeMB.toFixed(2)}MB). May fail with inlineData.`);
    }
    
    let postDescription = context?.postDescription;
    let structuredComments = context?.structuredComments ?? [];

    if (!postDescription || structuredComments.length === 0) {
      const metadata = await extractPostMetadata(url);
      if (metadata) {
        postDescription = postDescription || metadata.description;
        if (structuredComments.length === 0) {
          structuredComments = metadata.comments;
        }
      }
    }

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.15,
      },
    });

    const prompt = buildVideoExtractionPrompt({
      url,
      postDescription,
      comments: structuredComments,
    });

    if (onProgress) {
      onProgress('ai_extraction', 'Extraction des ingrédients avec Gemini...', 80);
    }
    
    console.log('🧠 Gemini is watching and listening...');
    
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'video/mp4',
          data: fileBase64,
        },
      },
      { text: prompt },
    ]);

    const response = await result.response;
    const responseText = response.text();
    
    const usageMetadata = response.usageMetadata;
    const usage = usageMetadata ? {
      promptTokens: usageMetadata.promptTokenCount || 0,
      candidatesTokens: usageMetadata.candidatesTokenCount || 0,
      totalTokens: usageMetadata.totalTokenCount || 0,
      costEUR: 0
    } : undefined;
    
    const cleanedJson = responseText.replace(/```json|```/g, '').trim();
    const recipeData = JSON.parse(cleanedJson);
    
    const recipe: Recipe = {
      ...recipeData,
      source_url: url,
      id: crypto.randomUUID(),
    };
    
    return { recipe, usage };

  } catch (error: any) {
    if (error.status === 429) {
      const retryDelay = error.errorDetails?.find((d: any) => d['@type']?.includes('RetryInfo'))?.retryDelay || 'unknown';
      console.error(`❌ Quota API Gemini dépassé (429). Limite free tier: 20 requêtes/jour. Retry dans: ${retryDelay}s`);
      console.error(`💡 Pour augmenter la limite, passez à un plan payant: https://ai.google.dev/pricing`);
    } else if (error.status === 404) {
      console.error(`❌ Modèle Gemini non trouvé (404). Vérifiez le nom du modèle.`);
    } else {
      console.error('⚠️ Erreur dans VideoAgent:', error.message || error);
    }
    return null;
  } finally {
    if (localPath && fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
        console.log('🗑️ Local file cleaned.');
      } catch (e) {
        console.error('Failed to delete local file', e);
      }
    }
  }
}

