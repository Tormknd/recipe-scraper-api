export interface Recipe {
  id?: string;
  title: string;
  ingredients: string[];
  steps: string[];
  image_url?: string;
  source_url: string;
  servings?: string;
  prep_time?: string;
  cook_time?: string;
  tips?: string[]; // Nouveauté : Conseils issus des commentaires ou de l'analyse
}

export interface ScrapedComment {
  text: string;
  author?: string;
  likes?: number;
}

export interface ScrapedData {
  text: string;
  screenshotBase64: string;
  url: string;
  title?: string;
  /** Lignes prêtes pour affichage / legacy */
  comments?: string[];
  /** Commentaires structurés (API TikTok/IG) — prioritaires pour Gemini */
  structuredComments?: ScrapedComment[];
  /** Description caption extraite par l'extracteur HTTP */
  postDescription?: string;
}

export interface ProcessingRequest {
  url: string;
}

export interface UsageMetrics {
  promptTokens?: number;
  candidatesTokens?: number;
  totalTokens?: number;
  costEUR?: number; // Coût estimé en euros
}

export interface ProgressInfo {
  stage?: string;
  message?: string;
  percentage?: number;
}

export interface ProcessingResponse {
  success: boolean;
  method?: 'web_scraping' | 'video_ai';
  data?: Recipe;
  saved?: boolean; // true si la recette a été enregistrée en base après extraction
  error?: string;
  progress?: ProgressInfo;
  usage?: UsageMetrics;
}
