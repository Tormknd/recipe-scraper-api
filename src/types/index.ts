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

export interface ScrapedData {
  text: string;
  screenshotBase64: string;
  url: string;
  title?: string;
  comments?: string[]; // Nouveauté : Commentaires utilisateurs
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
  error?: string;
  progress?: ProgressInfo; // Messages de progression (optionnel, pour compatibilité)
  usage?: UsageMetrics; // Métriques d'utilisation (tokens, coûts)
}
