import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';

const router = Router();

const createFolderSchema = z.object({
  name: z.string().min(1).max(200).transform((s) => s.trim()),
});

const updateFolderSchema = z.object({
  name: z.string().min(1).max(200).transform((s) => s.trim()),
});

/**
 * GET /folders - Liste tous les dossiers (avec nombre de recettes)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const folders = await prisma.folder.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { recipes: true } } },
    });
    const data = folders.map((f) => ({
      id: f.id,
      name: f.name,
      recipeCount: f._count.recipes,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));
    return res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /folders/:id - Détail d'un dossier + recettes
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const folder = await prisma.folder.findUnique({
      where: { id },
      include: {
        _count: { select: { recipes: true } },
        recipes: {
          include: { tags: { include: { tag: true } } },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    if (!folder) {
      return res.status(404).json({ success: false, error: 'Dossier introuvable' });
    }
    const { prismaRecipeToApp } = await import('../utils/recipeMapper');
    const recipes = folder.recipes.map((r) =>
      prismaRecipeToApp({ ...r, folder: folder })
    );
    return res.json({
      success: true,
      data: {
        id: folder.id,
        name: folder.name,
        recipeCount: folder._count.recipes,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        recipes,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /folders - Créer un dossier (ex: "Sucré", "Salé")
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parse = createFolderSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, error: 'Nom invalide', details: parse.error.errors });
    }
    const folder = await prisma.folder.create({ data: { name: parse.data.name } });
    return res.status(201).json({ success: true, data: folder });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la création';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * PATCH /folders/:id - Renommer un dossier
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parse = updateFolderSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, error: 'Nom invalide', details: parse.error.errors });
    }
    const folder = await prisma.folder.update({
      where: { id },
      data: { name: parse.data.name },
    });
    return res.json({ success: true, data: folder });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Dossier introuvable' });
    }
    const message = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * DELETE /folders/:id - Supprimer un dossier (les recettes restent, folderId mis à null)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.folder.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Dossier introuvable' });
    }
    const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
