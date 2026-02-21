import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';

const router = Router();

const createTagSchema = z.object({
  name: z.string().min(1).max(100).transform((s) => s.trim()),
});

/**
 * GET /tags - Liste tous les tags (pour filtre / autocomplete)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const tags = await prisma.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { recipes: true } } },
    });
    const data = tags.map((t) => ({
      id: t.id,
      name: t.name,
      recipeCount: t._count.recipes,
    }));
    return res.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur serveur';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /tags - Créer un tag (ou récupérer l'existant si même nom)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const parse = createTagSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, error: 'Nom de tag invalide', details: parse.error.errors });
    }
    const { name } = parse.data;

    const existing = await prisma.tag.findUnique({ where: { name } });
    if (existing) {
      return res.status(201).json({ success: true, data: existing });
    }

    const tag = await prisma.tag.create({ data: { name } });
    return res.status(201).json({ success: true, data: tag });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la création';
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
