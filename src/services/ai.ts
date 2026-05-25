import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { Recipe, ScrapedComment, ScrapedData } from '../types';
import { buildWebExtractionPrompt } from '../utils/geminiPrompt';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY is missing in environment variables.');
}

const genAI = new GoogleGenerativeAI(API_KEY || '');
const MODEL_NAME = 'gemini-flash-latest';

function resolveCommentsForPrompt(data: ScrapedData): ScrapedComment[] {
  if (data.structuredComments && data.structuredComments.length > 0) {
    return data.structuredComments;
  }
  return (data.comments ?? []).map((line) => ({ text: line }));
}

export class AIService {
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  constructor() {
    this.model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.15,
      },
    });
  }

  async extractRecipe(
    data: ScrapedData
  ): Promise<{ recipe: Recipe; isIncomplete: boolean; usage?: Record<string, number> }> {
    console.log(`[AI] Processing recipe for: ${data.url}`);

    const comments = resolveCommentsForPrompt(data);
    const prompt = buildWebExtractionPrompt({
      url: data.url,
      pageTitle: data.title,
      rawText: data.text,
      postDescription: data.postDescription,
      comments,
    });

    console.log('[AI] Input Text Preview:', data.text.substring(0, 200));
    console.log('[AI] Comments for Gemini:', comments.length);
    console.log(
      `[AI] postDescription: ${data.postDescription?.length ?? 0} chars (0 = web_scraping probablement vide)`
    );

    const imagePart: Part = {
      inlineData: {
        data: data.screenshotBase64,
        mimeType: 'image/jpeg',
      },
    };

    try {
      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();

      const usageMetadata = response.usageMetadata;
      const usage = usageMetadata
        ? {
            promptTokens: usageMetadata.promptTokenCount || 0,
            candidatesTokens: usageMetadata.candidatesTokenCount || 0,
            totalTokens: usageMetadata.totalTokenCount || 0,
            costEUR: 0,
          }
        : undefined;

      console.log(`[AI] Raw response preview: ${text.substring(0, 200)}...`);

      let parsedData: Record<string, unknown>;
      try {
        parsedData = JSON.parse(text);
      } catch {
        console.error('[AI] Failed to parse JSON response:', text.substring(0, 500));
        throw new Error('Invalid JSON response from AI');
      }

      console.log('[AI] Parsed data:', {
        title: parsedData.title,
        ingredientsCount: (parsedData.ingredients as unknown[])?.length || 0,
        stepsCount: (parsedData.steps as unknown[])?.length || 0,
        isIncomplete: parsedData.isIncomplete,
      });

      const recipe: Recipe = {
        title: (parsedData.title as string) || '',
        ingredients: (parsedData.ingredients as string[]) || [],
        steps: (parsedData.steps as string[]) || [],
        servings: parsedData.servings as string | undefined,
        prep_time: parsedData.prep_time as string | undefined,
        cook_time: parsedData.cook_time as string | undefined,
        tips: (parsedData.tips as string[]) || [],
        source_url: data.url,
        id: crypto.randomUUID(),
      };

      const isIncomplete = parsedData.isIncomplete === true;
      console.log(
        `[AI] Extraction result: isIncomplete=${isIncomplete}, steps=${recipe.steps.length}, ingredients=${recipe.ingredients.length}`
      );

      return { recipe, isIncomplete, usage };
    } catch (error) {
      console.error('[AI] Error processing with Gemini:', error);
      throw new Error('Failed to extract recipe via AI');
    }
  }
}
