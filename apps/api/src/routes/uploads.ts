import type { FastifyInstance } from 'fastify';
import { presignUploadSchema } from '@afrohit/shared';
import { requireAuth } from '../middleware/auth';
import { presignUpload } from '../lib/storage';

/**
 * Bring-your-own-audio uploads.
 *
 * The browser asks for a short-lived presigned PUT url, uploads the artist's
 * OWN beat/instrumental/vocal straight to object storage, then registers it
 * with the matching /projects/:id/beats/upload or /vocals/upload endpoint.
 *
 * We never touch or re-generate the artist's authentic audio — it flows through
 * mix/master exactly as uploaded.
 */
export default async function uploads(app: FastifyInstance) {
  app.post('/presign', { schema: { body: presignUploadSchema } }, async (req) => {
    const { workspaceId } = requireAuth(req);
    const { kind, contentType, ext } = presignUploadSchema.parse(req.body);
    return presignUpload({ workspaceId, kind: `uploads/${kind}`, contentType, ext });
  });
}
