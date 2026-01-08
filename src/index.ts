import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import PQueue from 'p-queue';
import pino from 'pino';
import { ScraperService } from './services/scraper';
import { AIService } from './services/ai';
import { processVideoRecipe } from './services/videoAgent';
import { validateRequest } from './utils/security';
import { UsageMetrics, Recipe, ProgressInfo } from './types';

dotenv.config();

// --- CONFIGURATION ---
const PORT = process.env.PORT || 5000;
const MAX_CONCURRENT_SCRAPES = 2; // Protection RAM pour VPS (1 Browser ~ 1GB RAM worst case)

// --- LOGGING ---
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

// --- QUEUE ---
// File d'attente pour ne jamais écrouler le serveur
const queue = new PQueue({ concurrency: MAX_CONCURRENT_SCRAPES });

const app = express();

// --- MIDDLEWARES DE SÉCURITÉ ---
app.use(helmet()); // Protection Headers HTTP
app.use(express.json({ limit: '1mb' })); // Limite la taille du body pour éviter DoS

// Rate Limiting (Anti-Brute Force / DoS)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limite chaque IP à 100 requêtes par fenêtre
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// CORS Restrictif (A configurer pour la prod)
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*', // Idéalement: 'https://chhaju.fr'
  methods: ['POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// --- SERVICES ---
const scraper = new ScraperService();
const aiService = new AIService();

// --- ROUTES ---

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    queueSize: queue.size, 
    pending: queue.pending,
    memory: process.memoryUsage().rss / 1024 / 1024 + ' MB'
  });
});

app.post('/process', async (req: Request, res: Response) => {
  // Timeout long pour le client (3 min)
  req.setTimeout(180000);
  res.setTimeout(180000);

  // 1. Validation de l'input (Securité SSRF)
  const validation = validateRequest.safeParse(req.body);
  if (!validation.success) {
    logger.warn({ ip: req.ip, error: validation.error }, 'Invalid Request Blocked');
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid URL provided', 
      details: validation.error.errors 
    });
  }

  const { url } = validation.data;
  logger.info({ url }, 'Request queued');

  // 2. Traitement via la Queue
  try {
    const result = await queue.add(async () => {
      logger.info({ url }, 'Processing started');
      
      let recipe: Recipe | null = null;
      let method = 'web_scraping';
      const usageMetrics: (UsageMetrics | undefined)[] = [];
      let currentProgress: ProgressInfo | undefined;
      
      // Fonction helper pour mettre à jour la progression
      const updateProgress = (stage: string, message: string, percentage: number) => {
        currentProgress = { stage, message, percentage };
        logger.info({ url, stage, message, percentage }, 'Progress update');
      };
      
      try {
        // A. Scraping
        updateProgress('scraping', 'Récupération du contenu...', 10);
        logger.info({ url }, 'Step 1: Starting web scraping...');
        const scrapedData = await scraper.scrapeUrl(url);
        logger.info({ 
          url, 
          textLength: scrapedData.text.length,
          commentsCount: scrapedData.comments?.length || 0 
        }, 'Scraping completed');
        
        // B. AI Analysis
        updateProgress('ai_analysis', 'Analyse du contenu avec Gemini...', 40);
        logger.info({ url }, 'Step 2: Starting AI extraction from scraped data...');
        const { recipe: extractedRecipe, isIncomplete, usage: scrapingUsage } = await aiService.extractRecipe(scrapedData);
        
        logger.info({ 
          url,
          title: extractedRecipe.title,
          ingredientsCount: extractedRecipe.ingredients?.length || 0,
          stepsCount: extractedRecipe.steps?.length || 0,
          isIncomplete,
          tokens: scrapingUsage?.totalTokens || 0
        }, 'AI extraction completed');
        
        if (scrapingUsage) {
          usageMetrics.push(scrapingUsage);
        }
        
        // C. Vérifier si la recette est complète
        const hasSteps = extractedRecipe.steps && extractedRecipe.steps.length > 0;
        const hasIngredients = extractedRecipe.ingredients && extractedRecipe.ingredients.length > 0;
        const isValidSteps = extractedRecipe.steps?.some(s => s && s.trim().length > 10) || false;
        
        logger.info({ 
          url,
          hasSteps,
          hasIngredients,
          isValidSteps,
          isIncomplete,
          stepsCount: extractedRecipe.steps?.length || 0
        }, 'Completeness check');
        
        // Si incomplète (pas d'étapes valides), basculer sur la vidéo
        if (isIncomplete || !hasSteps || !isValidSteps) {
          logger.warn({ 
            url, 
            reason: isIncomplete ? 'AI marked as incomplete' : 'No valid steps found',
            stepsCount: extractedRecipe.steps?.length || 0,
            ingredientsCount: extractedRecipe.ingredients?.length || 0
          }, 'Recipe incomplete - Switching to video analysis');
          
          try {
            updateProgress('video_download', 'Téléchargement de la vidéo...', 50);
            logger.info({ url }, 'Step 3: Starting video download and analysis...');
            const videoResult = await processVideoRecipe(url, updateProgress);
            
            if (videoResult && videoResult.recipe) {
              const videoSteps = videoResult.recipe.steps?.length || 0;
              logger.info({ 
                url,
                videoTitle: videoResult.recipe.title,
                videoSteps,
                videoIngredients: videoResult.recipe.ingredients?.length || 0
              }, 'Video analysis completed');
              
              // Si la vidéo a des étapes, on l'utilise
              if (videoSteps > 0) {
                recipe = videoResult.recipe;
                method = 'video_ai';
                if (videoResult.usage) {
                  usageMetrics.push(videoResult.usage);
                }
                logger.info({ url, method: 'video_ai' }, 'Using video analysis result');
              } else {
                // Vidéo sans étapes, on garde le scraping même incomplet
                recipe = extractedRecipe;
                logger.warn({ url }, 'Video analysis returned no steps, using incomplete scraping data');
              }
            } else {
              recipe = extractedRecipe;
              logger.warn({ url }, 'Video analysis failed, using incomplete scraping data');
            }
          } catch (videoError: any) {
            logger.error({ 
              url, 
              error: videoError.message,
              stack: videoError.stack 
            }, 'Video analysis error');
            recipe = extractedRecipe;
          }
        } else {
          // Recette complète depuis le scraping
          recipe = extractedRecipe;
          logger.info({ 
            url,
            method: 'web_scraping',
            stepsCount: extractedRecipe.steps?.length || 0
          }, 'Recipe is complete from web scraping');
        }
      } catch (scrapingError: any) {
        logger.error({ 
          url, 
          error: scrapingError.message,
          stack: scrapingError.stack 
        }, 'Web scraping failed, trying video analysis as fallback');
        
        try {
          updateProgress('video_download', 'Téléchargement de la vidéo...', 50);
          const videoResult = await processVideoRecipe(url, updateProgress);
          if (videoResult && videoResult.recipe) {
            recipe = videoResult.recipe;
            method = 'video_ai';
            if (videoResult.usage) {
              usageMetrics.push(videoResult.usage);
            }
            logger.info({ url }, 'Video analysis succeeded as fallback');
          } else {
            throw new Error('Both web scraping and video analysis failed');
          }
        } catch (videoError: any) {
          logger.error({ 
            url, 
            error: videoError.message 
          }, 'Video fallback also failed');
          throw scrapingError; // Throw original error
        }
      }
      
      if (!recipe) {
        throw new Error('Impossible d\'extraire la recette');
      }
      
      // Agréger les métriques d'utilisation
      const totalTokens = usageMetrics.reduce((sum, u) => sum + (u?.totalTokens || 0), 0);
      const aggregatedUsage = usageMetrics.length > 0 ? {
        promptTokens: usageMetrics.reduce((sum, u) => sum + (u?.promptTokens || 0), 0),
        candidatesTokens: usageMetrics.reduce((sum, u) => sum + (u?.candidatesTokens || 0), 0),
        totalTokens,
        costEUR: 0
      } : undefined;
      
      updateProgress('finalization', 'Structuration de la recette...', 90);
      
      logger.info({ 
        url, 
        method,
        title: recipe.title,
        stepsCount: recipe.steps?.length || 0,
        ingredientsCount: recipe.ingredients?.length || 0,
        totalTokens
      }, 'Processing completed - Recipe ready');
      
      return { recipe, method, usage: aggregatedUsage, progress: currentProgress };
    });

    logger.info({ 
      url, 
      method: result.method,
      tokens: result.usage?.totalTokens,
      stepsCount: result.recipe.steps?.length || 0
    }, 'Request completed successfully');
    
    return res.json({ 
      success: true, 
      method: result.method,
      data: result.recipe,
      progress: result.progress, // Inclure le dernier message de progression
      usage: result.usage
    });

  } catch (error: any) {
    logger.error({ 
      url, 
      err: error,
      message: error.message,
      stack: error.stack 
    }, 'Processing failed');
    
    const errorMessage = error.message || 'Internal server error';
    const isTimeout = errorMessage.includes('Timeout') || errorMessage.includes('timed out');
    
    return res.status(isTimeout ? 504 : 500).json({ 
      success: false, 
      error: 'Failed to process recipe',
      message: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
});

// --- SERVER START ---
const server = app.listen(PORT, () => {
  logger.info(`🚀 Scraper API (Secure) running on port ${PORT}`);
  logger.info(`🛡️ Security: RateLimit=ON, QueueLimit=${MAX_CONCURRENT_SCRAPES}, SSRF-Check=ON`);
});

server.setTimeout(190000);

// Graceful Shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
