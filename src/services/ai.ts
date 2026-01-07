import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import { Recipe, ScrapedData } from '../types';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY is missing in environment variables.");
}

const genAI = new GoogleGenerativeAI(API_KEY || '');
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

  async extractRecipe(data: ScrapedData): Promise<{ recipe: Recipe; isIncomplete: boolean; usage?: any }> {
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
        "tips": ["Tip from comments: bake at 180C instead", "Chef tip: use fresh basil"],
        "isIncomplete": false
      }

      **CRITICAL - DÉTECTION D'INCOMPLÉTUDE** :
      Tu DOIS mettre "isIncomplete": true si :
      - Il n'y a AUCUNE étape de préparation (steps vide ou absent)
      - Les ingrédients sont absents ou très incomplets
      - La description est très courte (< 50 mots) et ne contient pas les détails de préparation
      - Les temps de cuisson/préparation sont absents ET les étapes sont absentes
      
      Une recette SANS ÉTAPES est TOUJOURS incomplète, même si les ingrédients sont présents.
      
      Si "isIncomplete": true, l'API basculera automatiquement sur l'analyse vidéo pour compléter les informations manquantes.

      If you strictly cannot find a recipe, return a JSON with empty fields and "isIncomplete": true.
      
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
      
      // Extraire les métriques d'utilisation
      const usageMetadata = response.usageMetadata;
      const usage = usageMetadata ? {
        promptTokens: usageMetadata.promptTokenCount || 0,
        candidatesTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
        costEUR: 0 // Sera calculé dans index.ts
      } : undefined;
      
      console.log(`[AI] Raw response preview: ${text.substring(0, 200)}...`);

      let parsedData: any;
      try {
        parsedData = JSON.parse(text);
      } catch (parseError) {
        console.error('[AI] Failed to parse JSON response:', text.substring(0, 500));
        throw new Error('Invalid JSON response from AI');
      }
      
      console.log('[AI] Parsed data:', {
        title: parsedData.title,
        ingredientsCount: parsedData.ingredients?.length || 0,
        stepsCount: parsedData.steps?.length || 0,
        isIncomplete: parsedData.isIncomplete,
        hasTitle: !!parsedData.title,
        hasIngredients: !!(parsedData.ingredients && parsedData.ingredients.length > 0),
        hasSteps: !!(parsedData.steps && parsedData.steps.length > 0)
      });
      
      const recipe: Recipe = {
        title: parsedData.title || '',
        ingredients: parsedData.ingredients || [],
        steps: parsedData.steps || [],
        servings: parsedData.servings,
        prep_time: parsedData.prep_time,
        cook_time: parsedData.cook_time,
        tips: parsedData.tips || [],
        source_url: data.url,
        id: crypto.randomUUID(),
      };
      
      const isIncomplete = parsedData.isIncomplete === true;
      console.log(`[AI] Extraction result: isIncomplete=${isIncomplete}, steps=${recipe.steps.length}, ingredients=${recipe.ingredients.length}`);
      
      return { recipe, isIncomplete, usage };

    } catch (error) {
      console.error('[AI] Error processing with Gemini:', error);
      throw new Error('Failed to extract recipe via AI');
    }
  }
}
