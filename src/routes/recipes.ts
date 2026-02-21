import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { prismaRecipeToApp, appRecipeToPrismaPayload } from '../utils/recipeMapper';
import type { Recipe } from '../types';

type RecipeListResponse = { success: true; data: ReturnType<typeof prismaRecipeToApp>[] };
type RecipeOneResponse = { success: true; data: ReturnType<typeof prismaRecipeToApp> };

const router = Router();

const recipeBodySchema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.string()).default([]),
  steps: z.array(z.string()).default([]),
  source_url: z.string().url(),
  image_url: z.string().url().optional(),
  servings: z.string().optional(),
  prep_time: z.string().optional(),
  cook_time: z.string().optional(),
  tips: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  folderId: z.string().nullable().optional(),
});

const updateRecipeSchema = recipeBodySchema.partial();

function getSearchQuerySchema(req: Request) {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const tagIds = req.query.tagIds;
  const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : undefined;
  const tagIdList = Array.isArray(tagIds)
    ? (tagIds as string[]).filter((t) => typeof t === 'string')
    : typeof tagIds === 'string'
      ? tagIds.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  return { q, tagIdList, folderId };
}

/**
 * GET /recipes - Liste avec recherche et filtres
 * Query: q (texte), tagIds (string ou array), folderId
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { q, tagIdList, folderId } = getSearchQuerySchema(req);

    const where: Record<string, unknown> = {};

    if (folderId) {
      where.folderId = folderId;
    }

    if (tagIdList.length > 0) {
      where.AND = (where.AND as unknown[] || []).concat(
        tagIdList.map((tagId) => ({ tags: { some: { tagId } } }))
      );
    }

    if (q.length > 0) {
      const textCondition = {
        OR: [
          { title: { contains: q } },
          { ingredients: { contains: q } },
          { steps: { contains: q } },
        ],
      };
      where.AND = (where.AND as unknown[] || []).concat([textCondition]);
    }

    const rows = await prisma.recipe.findMany({
      where,
      include: { tags: { include: { tag: true } }, folder: true },
      orderBy: { updatedAt: 'desc' },
    });

    const data = rows.map(prismaRecipeToApp);
    return res.json({ success: true, data } as RecipeListResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la recherche';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /recipes/:id - Détail d'une recette
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const row = await prisma.recipe.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } }, folder: true },
    });
    if (!row) {
      return res.status(404).json({ success: false, error: 'Recette introuvable' });
    }
    return res.json({ success: true, data: prismaRecipeToApp(row) } as RecipeOneResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /recipes - Créer une recette (depuis /process ou saisie manuelle)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parse = recipeBodySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, error: 'Données invalides', details: parse.error.errors });
    }
    const { tagIds, folderId, ...recipeFields } = parse.data;
    const payload = appRecipeToPrismaPayload(recipeFields as Recipe);

    const created = await prisma.recipe.create({
      data: {
        ...payload,
        folderId: folderId ?? undefined,
      },
    });

    if (tagIds && tagIds.length > 0) {
      await prisma.recipeTag.createMany({
        data: tagIds.map((tagId) => ({ recipeId: created.id, tagId })),
      });
    }

    const row = await prisma.recipe.findUnique({
      where: { id: created.id },
      include: { tags: { include: { tag: true } }, folder: true },
    });
    return res.status(201).json({ success: true, data: prismaRecipeToApp(row!) } as unknown as RecipeOneResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la création';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * PATCH /recipes/:id - Mettre à jour (titre, tags, dossier, etc.)
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parse = updateRecipeSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, error: 'Données invalides', details: parse.error.errors });
    }

    const existing = await prisma.recipe.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Recette introuvable' });
    }

    const { tagIds, folderId, ...recipeFields } = parse.data;

    const updateData: Record<string, unknown> = {};
    if (Object.keys(recipeFields).length > 0) {
      Object.assign(updateData, appRecipeToPrismaPayload(recipeFields as Recipe));
    }
    if (folderId !== undefined) {
      updateData.folderId = folderId;
    }

    await prisma.recipe.update({
      where: { id },
      data: updateData as Parameters<typeof prisma.recipe.update>[0]['data'],
    });

    if (tagIds !== undefined) {
      await prisma.recipeTag.deleteMany({ where: { recipeId: id } });
      if (tagIds.length > 0) {
      await prisma.recipeTag.createMany({
        data: tagIds.map((tagId) => ({ recipeId: id, tagId })),
      });
      }
    }

    const row = await prisma.recipe.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } }, folder: true },
    });
    return res.json({ success: true, data: prismaRecipeToApp(row!) } as unknown as RecipeOneResponse);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * DELETE /recipes/:id
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.recipe.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Recette introuvable' });
    }
    const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
