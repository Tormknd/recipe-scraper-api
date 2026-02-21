import type { Recipe as AppRecipe } from '../types';

/** Forme d’une recette Prisma avec relations (évite de dépendre des exports @prisma/client au build) */
export type PrismaRecipeRow = {
  id: string;
  title: string;
  ingredients: string;
  steps: string;
  sourceUrl: string;
  imageUrl: string | null;
  servings: string | null;
  prepTime: string | null;
  cookTime: string | null;
  tips: string | null;
  folderId: string | null;
  tags?: { tag: { id: string; name: string } }[];
  folder?: { id: string; name: string } | null;
};

function parseJsonArray(value: string | null): string[] {
  if (value == null || value === '') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function prismaRecipeToApp(row: PrismaRecipeRow): AppRecipe & { id: string; tagIds?: string[]; tagNames?: string[]; folderId?: string | null; folderName?: string | null } {
  const tagNames = row.tags?.map((t: { tag: { id: string; name: string } }) => t.tag.name) ?? [];
  const tagIds = row.tags?.map((t: { tag: { id: string; name: string } }) => t.tag.id) ?? [];
  return {
    id: row.id,
    title: row.title,
    ingredients: parseJsonArray(row.ingredients),
    steps: parseJsonArray(row.steps),
    source_url: row.sourceUrl,
    image_url: row.imageUrl ?? undefined,
    servings: row.servings ?? undefined,
    prep_time: row.prepTime ?? undefined,
    cook_time: row.cookTime ?? undefined,
    tips: parseJsonArray(row.tips),
    tagIds: tagIds.length ? tagIds : undefined,
    tagNames: tagNames.length ? tagNames : undefined,
    folderId: row.folderId ?? undefined,
    folderName: row.folder?.name ?? undefined,
  };
}

export function appRecipeToPrismaPayload(recipe: AppRecipe): {
  title: string;
  ingredients: string;
  steps: string;
  sourceUrl: string;
  imageUrl?: string | null;
  servings?: string | null;
  prepTime?: string | null;
  cookTime?: string | null;
  tips?: string | null;
} {
  return {
    title: recipe.title,
    ingredients: JSON.stringify(recipe.ingredients ?? []),
    steps: JSON.stringify(recipe.steps ?? []),
    sourceUrl: recipe.source_url,
    imageUrl: recipe.image_url ?? null,
    servings: recipe.servings ?? null,
    prepTime: recipe.prep_time ?? null,
    cookTime: recipe.cook_time ?? null,
    tips: recipe.tips ? JSON.stringify(recipe.tips) : null,
  };
}
