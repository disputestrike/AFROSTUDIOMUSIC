import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@afrohit/db';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from './admin';
import { searchLexicon, lexiconStats } from '../lib/lexicon';

/**
 * THE WORD BANK API — browse/search thousands of authentic African/diaspora
 * terms and add your own. Shared library (workspaceId null) + private additions.
 */
export default async function lexicon(app: FastifyInstance) {
  // TENANT SURFACE ISOLATION (Wave 8a): the word bank is studio training
  // infrastructure — generation consumes it server-side (lexiconPalette), so
  // consumers lose nothing. Server-enforced operator-only for every route.
  app.addHook('preValidation', async (req) => {
    await requireAdmin(req);
  });

  app.get<{ Querystring: { q?: string; language?: string; category?: string; take?: string } }>('/', async (req) => {
    const { workspaceId } = requireAuth(req);
    const entries = await searchLexicon({
      workspaceId,
      q: req.query.q,
      language: req.query.language,
      category: req.query.category,
      take: req.query.take ? Number(req.query.take) : 300,
    });
    return { total: entries.length, entries };
  });

  app.get('/stats', async (req) => {
    const { workspaceId } = requireAuth(req);
    return lexiconStats(workspaceId);
  });

  const addSchema = z.object({
    term: z.string().min(1).max(120),
    language: z.string().min(2).max(12),
    category: z.string().min(2).max(24),
    register: z.string().max(24).optional(),
    meaning: z.string().max(400).optional(),
    example: z.string().max(400).optional(),
    tags: z.array(z.string().max(24)).max(6).optional(),
  });
  app.post('/', { schema: { body: addSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = addSchema.parse(req.body);
    const entry = await prisma.lexiconEntry.upsert({
      where: { term_language_category: { term: input.term, language: input.language, category: input.category } },
      create: { ...input, tags: input.tags ?? [], workspaceId, source: 'user' },
      update: { register: input.register, meaning: input.meaning, example: input.example, tags: input.tags ?? [] },
    });
    reply.code(201);
    return entry;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    // Only a workspace's OWN additions can be deleted — never the shared seed.
    const gone = await prisma.lexiconEntry.deleteMany({ where: { id: req.params.id, workspaceId } });
    if (gone.count === 0) return reply.code(404).send({ error: 'not_found_or_shared', message: 'Shared library terms cannot be deleted; only your own additions.' });
    return { deleted: true };
  });
}
