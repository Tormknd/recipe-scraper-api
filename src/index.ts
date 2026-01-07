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
import { UsageMetrics, Recipe } from './types';

dotenv.config();

const PORT = process.env.PORT || 5000;
const MAX_CONCURRENT_SCRAPES = 1;

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

const queue = new PQueue({ concurrency: MAX_CONCURRENT_SCRAPES });

const cleanMemory = () => {
  if (global.gc) {
    logger.debug('🧹 Garbage Collection triggered');
    global.gc();
  } else {
    logger.warn('⚠️  Garbage Collector not available. Start with --expose-gc flag.');
  }
};

const GEMINI_INPUT_COST_PER_MILLION_TOKENS = 0.075 * 0.92;
const GEMINI_OUTPUT_COST_PER_MILLION_TOKENS = 0.30 * 0.92;

function calculateCost(usage: UsageMetrics | undefined): number {
  if (!usage || !usage.totalTokens) return 0;
  
  const inputTokens = usage.promptTokens || 0;
  const outputTokens = usage.candidatesTokens || 0;
  
  const inputCost = (inputTokens / 1_000_000) * GEMINI_INPUT_COST_PER_MILLION_TOKENS;
  const outputCost = (outputTokens / 1_000_000) * GEMINI_OUTPUT_COST_PER_MILLION_TOKENS;
  
  return inputCost + outputCost;
}

function isRecipeComplete(recipe: Recipe, isIncomplete: boolean): { complete: boolean; reason?: string } {
  if (isIncomplete) {
    return { complete: false, reason: 'AI marked as incomplete' };
  }
  
  if (!recipe.steps || recipe.steps.length === 0) {
    return { complete: false, reason: 'No preparation steps found' };
  }
  
  if (!recipe.ingredients || recipe.ingredients.length === 0) {
    return { complete: false, reason: 'No ingredients found' };
  }
  
  const validSteps = recipe.steps.filter((step: string) => step && step.trim().length > 10);
  if (validSteps.length === 0) {
    return { complete: false, reason: 'Steps are too short or empty' };
  }
  
  const validIngredients = recipe.ingredients.filter((ing: string) => ing && ing.trim().length > 2);
  if (validIngredients.length === 0) {
    return { complete: false, reason: 'Ingredients are too short or empty' };
  }
  
  return { complete: true };
}

function aggregateUsage(usages: (UsageMetrics | undefined)[]): UsageMetrics | undefined {
  const validUsages = usages.filter(u => u !== undefined) as UsageMetrics[];
  if (validUsages.length === 0) return undefined;
  
  const aggregated: UsageMetrics = {
    promptTokens: validUsages.reduce((sum, u) => sum + (u.promptTokens || 0), 0),
    candidatesTokens: validUsages.reduce((sum, u) => sum + (u.candidatesTokens || 0), 0),
    totalTokens: validUsages.reduce((sum, u) => sum + (u.totalTokens || 0), 0),
    costEUR: 0
  };
  
  aggregated.costEUR = calculateCost(aggregated);
  return aggregated;
}

const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' }
});
app.use(limiter);

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const scraper = new ScraperService();
const aiService = new AIService();

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    queueSize: queue.size, 
    pending: queue.pending,
    memory: process.memoryUsage().rss / 1024 / 1024 + ' MB'
  });
});

app.post('/process', async (req: Request, res: Response) => {
  req.setTimeout(300000);
  res.setTimeout(300000);

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

  try {
    const result = await queue.add(async () => {
      logger.info({ url }, 'Processing started');
      
      let recipe = null;
      let method = 'web_scraping';
      const usageMetrics: (UsageMetrics | undefined)[] = [];
      
      try {
        const scrapedData = await scraper.scrapeUrl(url);
        const { recipe: extractedRecipe, isIncomplete, usage: scrapingUsage } = await aiService.extractRecipe(scrapedData);
        
        if (scrapingUsage) {
          scrapingUsage.costEUR = calculateCost(scrapingUsage);
          usageMetrics.push(scrapingUsage);
        }
        
        const completenessCheck = isRecipeComplete(extractedRecipe, isIncomplete);
        
        if (!completenessCheck.complete) {
          logger.info({ 
            url, 
            reason: completenessCheck.reason,
            stepsCount: extractedRecipe.steps?.length || 0,
            ingredientsCount: extractedRecipe.ingredients?.length || 0,
            aiIncomplete: isIncomplete
          }, 'Switching to video analysis - Incomplete data detected');
          
          try {
            const videoResult = await processVideoRecipe(url);
            if (videoResult && videoResult.recipe) {
              const videoCompleteness = isRecipeComplete(videoResult.recipe, false);
              
              if (videoCompleteness.complete || 
                  (videoResult.recipe.steps && videoResult.recipe.steps.length > 0)) {
                recipe = videoResult.recipe;
                method = 'video_ai';
                if (videoResult.usage) {
                  videoResult.usage.costEUR = calculateCost(videoResult.usage);
                  usageMetrics.push(videoResult.usage);
                }
                logger.info({ 
                  url,
                  stepsFromVideo: videoResult.recipe.steps?.length || 0
                }, 'Video analysis succeeded - Steps extracted');
              } else {
                recipe = extractedRecipe;
                logger.warn({ url }, 'Video analysis completed but no steps extracted, using scraping data');
              }
            } else {
              recipe = extractedRecipe;
              logger.warn({ url, reason: completenessCheck.reason }, 'Video analysis failed, using incomplete scraping data');
            }
          } catch (videoError: any) {
            const errorMessage = videoError.message || 'Unknown error';
            const isQuotaError = errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('Too Many Requests');
            
            if (isQuotaError) {
              logger.warn({ 
                url, 
                error: 'API quota exceeded',
                details: 'Gemini free tier limit (20 requests/day) reached. Video analysis unavailable.'
              }, 'Video analysis quota exceeded, using scraping data');
            } else {
              logger.error({ url, error: errorMessage }, 'Video analysis error, using scraping data');
            }
            recipe = extractedRecipe;
          }
        } else {
          recipe = extractedRecipe;
          logger.info({ 
            url,
            stepsCount: extractedRecipe.steps?.length || 0,
            ingredientsCount: extractedRecipe.ingredients?.length || 0
          }, 'Web scraping data is complete');
        }
      } catch (scrapingError: any) {
        logger.warn({ url, error: scrapingError.message }, 'Web scraping failed, trying video analysis');
        
        const videoResult = await processVideoRecipe(url);
        if (videoResult && videoResult.recipe) {
          recipe = videoResult.recipe;
          method = 'video_ai';
          if (videoResult.usage) {
            videoResult.usage.costEUR = calculateCost(videoResult.usage);
            usageMetrics.push(videoResult.usage);
          }
          logger.info({ url }, 'Video analysis succeeded as fallback');
        } else {
          throw new Error('Both web scraping and video analysis failed');
        }
      }
      
      if (!recipe) {
        throw new Error('Impossible d\'extraire la recette');
      }
      
      const aggregatedUsage = aggregateUsage(usageMetrics);
      return { recipe, method, usage: aggregatedUsage };
    });

    logger.info({ url, method: result.method, tokens: result.usage?.totalTokens, cost: result.usage?.costEUR }, 'Processing completed successfully');
    return res.json({ 
      success: true, 
      method: result.method,
      data: result.recipe,
      usage: result.usage
    });

  } catch (error: any) {
    logger.error({ url, err: error }, 'Processing failed');
    
    const errorMessage = error.message || 'Internal server error';
    const isTimeout = errorMessage.includes('Timeout') || errorMessage.includes('timed out');
    
    return res.status(isTimeout ? 504 : 500).json({ 
      success: false, 
      error: 'Failed to process recipe',
      message: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  } finally {
    cleanMemory();
  }
});

const server = app.listen(PORT, () => {
  logger.info(`🚀 Scraper API (Secure) running on port ${PORT}`);
  logger.info(`🛡️ Security: RateLimit=ON, QueueLimit=${MAX_CONCURRENT_SCRAPES}, SSRF-Check=ON`);
});

server.setTimeout(310000);

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
