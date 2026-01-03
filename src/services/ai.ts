import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { Recipe, ScrapedData } from '../types';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY is missing in environment variables.");
}

const genAI = new GoogleGenerativeAI(API_KEY || '');

// Fallback to the stable flash model
const MODEL_NAME = 'gemini-flash-latest';

export class AIService {
  private model: any;

  constructor() {
    this.model = genAI.getGenerativeModel({ 
      model: MODEL_NAME,
      generationConfig: {
        responseMimeType: "application/json",
      }
    });
  }

  async extractRecipe(data: ScrapedData): Promise<Recipe> {
    console.log(`[AI] Processing recipe for: ${data.url}`);

    const commentsContext = data.comments && data.comments.length > 0 
      ? `USER COMMENTS (Use these to identify tips, warnings, or corrections):
         ${data.comments.join('\n- ')}`
      : 'No user comments available.';

    const prompt = `
      You are an expert chef and data extractor. 
      Analyze the provided text, screenshot, and user comments from a social media post to extract a structured recipe.
      
      CONTEXT:
      - The input contains multiple sources: META_DESCRIPTION (often truncated), JSON_LD, and FULL_VISIBLE_BODY/PRIORITY_CAPTION_DOM.
      - **CRITICAL**: Prioritize 'FULL_VISIBLE_BODY' and 'PRIORITY_CAPTION_DOM' for the recipe steps and ingredients, as they contain the full untruncated text (e.g. looking for "40min", "enfourner", etc.). META_DESCRIPTION is often cut off.
      - The text might be unstructured, contain hashtags, or be incomplete.
      - The screenshot is the primary source of truth if the text is completely blocked.
      - **CRITICAL**: Read the "USER COMMENTS". If users mention corrections (e.g. "Cook at 180C not 160C", "Add more sugar"), add these as "tips".
      - If the language is not French, TRANSLATE everything to FRENCH.
      
      OUTPUT FORMAT (Strict JSON):
      {
        "title": "Recipe Title",
        "ingredients": ["ingredient 1", "ingredient 2"],
        "steps": ["step 1", "step 2"],
        "servings": "number of servings (approx)",
        "prep_time": "preparation time (approx)",
        "cook_time": "cooking time (approx)",
        "tips": ["Tip from comments: bake at 180C instead", "Chef tip: use fresh basil"]
      }

      If you strictly cannot find a recipe, return a JSON with empty fields but do not throw an error.
      
      Page Title: ${data.title}
      Source URL: ${data.url}
      
      ${commentsContext}

      Raw Text Content:
      ${data.text.substring(0, 15000)}
    `;

    console.log('[AI] Input Text Preview:', data.text.substring(0, 200));
    console.log('[AI] Comments Count:', data.comments?.length || 0);

    const imagePart: Part = {
      inlineData: {
        data: data.screenshotBase64,
        mimeType: "image/jpeg",
      },
    };

    try {
      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text();
      
      // console.log(`[AI] Raw response: ${text.substring(0, 100)}...`);

      const recipe: Recipe = JSON.parse(text);
      
      // Enrich with metadata
      recipe.source_url = data.url;
      recipe.id = crypto.randomUUID(); 

      return recipe;

    } catch (error) {
      console.error('[AI] Error processing with Gemini:', error);
      throw new Error('Failed to extract recipe via AI');
    }
  }
}
