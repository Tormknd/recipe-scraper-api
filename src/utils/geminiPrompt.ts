import { ScrapedComment } from '../types';

const RECIPE_JSON_SCHEMA = `{
  "title": "Titre de la recette",
  "ingredients": ["quantité + ingrédient", "..."],
  "steps": ["étape 1", "étape 2"],
  "servings": "nombre de portions (approx)",
  "prep_time": "temps de préparation",
  "cook_time": "temps de cuisson",
  "tips": ["astuce 1", "astuce 2"],
  "isIncomplete": false
}`;

function formatCommentsJson(comments: ScrapedComment[]): string {
  if (comments.length === 0) return '[]';
  return JSON.stringify(
    comments.map((c) => ({
      author: c.author ?? null,
      text: c.text,
      likes: c.likes ?? null,
    })),
    null,
    2
  );
}

const ARBITRATION_RULES = `
RÈGLES D'ARBITRAGE (ordre de priorité) :
1. Les créateurs oublient souvent des ingrédients dans la vidéo ou le texte à l'écran — vérifie toujours la DESCRIPTION du post.
2. Les créateurs corrigent leurs erreurs dans les COMMENTAIRES (souvent épinglés ou avec beaucoup de likes). Si une quantité, un temps ou un ingrédient diverge entre vidéo/texte et un commentaire du créateur (ou correction explicite), LA VERSION DES COMMENTAIRES DU CRÉATEUR PRIME.
3. Les abonnés posent des questions dans les commentaires (ex. « Quelle taille de moule ? ») et le créateur répond — intègre ces réponses dans "tips".
4. Texte incrusté dans la vidéo (overlays) : en cas de conflit audio vs overlay, privilégie l'overlay pour les quantités.
5. Langue : si le contenu n'est pas en français, TRADUIS titre, ingrédients, étapes et tips en français.
`.trim();

export function buildWebExtractionPrompt(params: {
  url: string;
  pageTitle?: string;
  rawText: string;
  postDescription?: string;
  comments: ScrapedComment[];
}): string {
  const descriptionBlock =
    params.postDescription?.trim() ||
    '(extraire depuis DESCRIPTION_FULL dans le contenu brut ci-dessous)';

  return `
Tu es un expert culinaire chargé de retranscrire des recettes depuis des posts Instagram ou TikTok.
Tu reçois : un screenshot de la page, le texte scrapé, la description du post, et un export JSON des meilleurs commentaires.

MISSION :
Génère une recette structurée au format JSON strict (titre, temps, ingrédients, étapes, astuces).

${ARBITRATION_RULES}

DESCRIPTION DU POST :
${descriptionBlock}

COMMENTAIRES EXTRAITS (JSON, triés par pertinence/likes) :
${formatCommentsJson(params.comments)}

CONTENU BRUT DE LA PAGE (DESCRIPTION_FULL, meta, JSON-LD, body) :
${params.rawText.substring(0, 15000)}

SORTIE ATTENDUE — JSON uniquement, sans markdown :
${RECIPE_JSON_SCHEMA}

DÉTECTION D'INCOMPLÉTUDE — mets "isIncomplete": true si :
- Aucune étape de préparation valide (steps vide ou étapes trop vagues)
- Ingrédients absents ou manifestement incomplets
- Description très courte (< 50 mots) sans détails de préparation

Une recette SANS ÉTAPES est TOUJOURS incomplète. Dans ce cas l'API lancera une analyse vidéo.

URL source : ${params.url}
Titre page : ${params.pageTitle ?? '(inconnu)'}
`.trim();
}

export function buildVideoExtractionPrompt(params: {
  url: string;
  postDescription?: string;
  comments: ScrapedComment[];
}): string {
  const descriptionBlock = params.postDescription?.trim() || '(non fournie — déduire depuis la vidéo)';

  return `
Tu es un expert culinaire. Tu analyses la VIDÉO (audio + visuel + textes à l'écran) d'un post Instagram ou TikTok.
On t'a aussi fourni la description du post et les commentaires les plus utiles pour corriger ou compléter la recette.

MISSION :
Génère une recette structurée en JSON strict. Ignore les intros hors-sujet.

${ARBITRATION_RULES}

DESCRIPTION DU POST :
${descriptionBlock}

COMMENTAIRES EXTRAITS (JSON) :
${formatCommentsJson(params.comments)}

SORTIE ATTENDUE — JSON uniquement, sans markdown :
${RECIPE_JSON_SCHEMA.replace('"isIncomplete": false', '"isIncomplete": false')}
(Pour l'analyse vidéo, mets isIncomplete à false si tu extrais au moins 2 étapes exploitables.)
`.trim();
}
