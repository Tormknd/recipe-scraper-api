import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import PQueue from 'p-queue';
import pino from 'pino';
import { ScraperService } from './services/scraper';
import { AIService } from './services/ai';
import { validateRequest } from './utils/security';

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
      
      // A. Scraping
      const scrapedData = await scraper.scrapeUrl(url);
      
      // B. AI Analysis
      const recipe = await aiService.extractRecipe(scrapedData);
      
      return recipe;
    });

    logger.info({ url }, 'Processing completed successfully');
    return res.json({ success: true, data: result });

  } catch (error: any) {
    logger.error({ url, err: error }, 'Processing failed');
    
    // Ne jamais renvoyer l'erreur stack trace brute au client en prod
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
