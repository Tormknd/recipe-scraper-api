import { GoogleGenerativeAI } from '@google/generative-ai';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import { Recipe, UsageMetrics } from '../types';
import dotenv from 'dotenv';

dotenv.config();

const execPromise = promisify(exec);

// Configuration
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error('GEMINI_API_KEY is required for video processing');
}

const genAI = new GoogleGenerativeAI(API_KEY);
const MODEL_NAME = 'gemini-flash-latest';

// Chemin vers le fichier cookies (dans le conteneur Docker)
// En production Docker: /app/cookies.txt
// En dev local: ./cookies.txt à la racine
const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(process.cwd(), 'cookies.txt');
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function downloadVideo(url: string, outputFilename: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const outputPath = path.resolve(tmpDir, outputFilename);
  
  // Vérifier si le fichier cookies existe
  const hasCookies = fs.existsSync(COOKIES_PATH);
  const cookiesArg = hasCookies ? `--cookies "${COOKIES_PATH}"` : '';
  
  if (hasCookies) {
    console.log(`🍪 Using cookies from: ${COOKIES_PATH}`);
  } else {
    console.warn(`⚠️ No cookies file found at ${COOKIES_PATH} - Instagram may block requests from datacenter IP`);
  }
  
  const strategies = [
    {
      name: '720p optimized',
      command: `yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --user-agent "${USER_AGENT}" ${cookiesArg} --force-overwrites --no-warnings -o "${outputPath}" "${url}"`
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
      console.warn(`⚠️ Strategy "${strategy.name}" failed: ${errorMsg.substring(0, 150)}`);
      
      // Log plus détaillé pour debug
      if (fullError.includes('429') || fullError.includes('Too Many Requests')) {
        console.error('❌ Rate limit détecté (429) - IP bloquée par Instagram');
      } else if (fullError.includes('401') || fullError.includes('Unauthorized') || fullError.includes('Login')) {
        console.error('❌ Authentification requise - Vérifiez les cookies');
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
  
  const cookiesInfo = fs.existsSync(COOKIES_PATH) ? ' (cookies utilisés)' : ' (pas de cookies)';
  throw new Error(`Impossible de télécharger la vidéo (toutes les stratégies ont échoué)${cookiesInfo}. Vérifiez les logs ci-dessus pour plus de détails.`);
}

export async function processVideoRecipe(url: string): Promise<{ recipe: Recipe; usage?: UsageMetrics } | null> {
  const timestamp = Date.now();
  const tempFilename = `recipe_${timestamp}.mp4`;
  let localPath: string | null = null;

  try {
    localPath = await downloadVideo(url, tempFilename);

    const fileBuffer = fs.readFileSync(localPath);
    const fileBase64 = fileBuffer.toString('base64');
    const fileSizeMB = fileBuffer.length / (1024 * 1024);
    
    if (fileSizeMB > 20) {
      console.warn(`⚠️ Video file is large (${fileSizeMB.toFixed(2)}MB). May fail with inlineData.`);
    }
    
    const model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
      }
    });
    
    const prompt = `
      Tu es un Chef Expert. Analyse cette vidéo (visuel + audio).
      Ignore les intros inutiles. Concentre-toi sur la recette.
      
      EXTRAIS EN JSON STRICT :
      {
        "title": "Titre précis",
        "ingredients": ["qté + nom", "qté + nom"],
        "steps": ["étape 1", "étape 2"],
        "prep_time": "XX min",
        "cook_time": "XX min",
        "servings": "X personnes",
        "tips": ["astuce du chef"]
      }
      Retourne uniquement le JSON sans markdown.
    `;

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

