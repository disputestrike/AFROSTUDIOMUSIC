import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { presignUploadSchema, importUrlSchema, audioUploadSchema } from '@afrohit/shared';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth';
import { presignAssetRef, presignUpload, putBytes, sniffAudioFormat } from '../lib/storage';
import { assertSafeUrl, safeFetch } from '../lib/url-guard';
import { enqueueHarvest, enqueueLearn } from '../lib/harvest';
import { registerVocalForInspection } from '../lib/vocal-ingest';
import { registerBeatForInspection } from '../lib/beat-ingest';

/**
 * Bring-your-own-audio uploads + legal URL import.
 *
 * Presign: the browser gets a short-lived PUT url and uploads the artist's OWN
 * beat/instrumental/vocal/song straight to object storage.
 *
 * Import: pull audio from a URL the artist has the RIGHTS to — their own files,
 * direct audio links, royalty-free / Creative-Commons sources. This is NOT a
 * streaming-platform ripper: YouTube/Spotify/etc. hosts are refused, because
 * re-using their catalog is uncleared copyright infringement.
 */

const MAX_IMPORT_BYTES = 80 * 1024 * 1024; // 80 MB
const IMPORT_TIMEOUT_MS = 30_000;

async function readWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('source returned no body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('file_too_large');
      throw Object.assign(new Error('file_too_large'), { statusCode: 413 });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function extFromContentType(ct: string, url: string): string {
  const map: Record<string, string> = {
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/aiff': 'aiff',
  };
  if (map[ct.split(';')[0]!.trim()]) return map[ct.split(';')[0]!.trim()]!;
  const urlExt = url.split('?')[0]!.split('.').pop()?.toLowerCase();
  return ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aiff'].includes(urlExt ?? '') ? urlExt! : 'mp3';
}

function provenanceUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return 'invalid-source-url';
  }
}

async function ensureSong(workspaceId: string, projectId: string, title: string): Promise<string> {
  const existing = await prisma.song.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.song.create({
    data: { workspaceId, projectId, title, status: 'SKETCH' },
    select: { id: true },
  });
  return created.id;
}

export default async function uploads(app: FastifyInstance) {
  app.post('/presign', { schema: { body: presignUploadSchema } }, async (req) => {
    const { workspaceId } = requireAuth(req);
    const { kind, contentType, ext, sizeBytes } = presignUploadSchema.parse(req.body);
    return presignUpload({ workspaceId, kind: `uploads/${kind}`, contentType, ext, sizeBytes });
  });

  // Proxied upload: browser → our API → R2 (server-side S3 creds). Avoids the
  // browser→R2 cross-origin PUT entirely, so it works even when the R2 bucket
  // has no CORS policy. Used for small audio like the Shazam mic capture.
  app.post(
    '/audio',
    { bodyLimit: 43 * 1024 * 1024, schema: { body: audioUploadSchema } },
    async (req, reply) => {
      const { workspaceId } = requireAuth(req);
      const { kind, contentType, ext, dataBase64 } = audioUploadSchema.parse(req.body);
      const b64 = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length < 1000) return reply.code(400).send({ error: 'audio_too_small' });
      if (bytes.length > 30 * 1024 * 1024) return reply.code(413).send({ error: 'audio_too_large' });
      const detected = sniffAudioFormat(bytes.subarray(0, 64));
      if (!detected) return reply.code(415).send({ error: 'unsupported_or_invalid_audio' });
      const declaredFormat = ext;
      if (declaredFormat !== detected) {
        return reply.code(415).send({ error: 'audio_type_mismatch', declared: declaredFormat, detected });
      }
      const safeKind = /^[a-z0-9_-]{1,20}$/.test(kind) ? kind : 'reference';
      const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'webm';
      const key = `${workspaceId}/uploads/${safeKind}/${nanoid()}.${safeExt}`;
      const url = await putBytes(key, bytes, contentType || 'audio/webm');
      return { key, assetRef: url, publicUrl: url, playbackUrl: await presignAssetRef(url, 900) };
    }
  );

  app.post('/import', { schema: { body: importUrlSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = importUrlSchema.parse(req.body);
    if (input.kind === 'vocal' && input.isolationConfirmed !== true) {
      return reply.code(422).send({
        error: 'isolated_vocal_confirmation_required',
        message: 'Confirm this link is an isolated vocal, not a finished song or instrumental.',
      });
    }

    // SSRF + copyright guard: resolves DNS, blocks private/metadata targets and
    // streaming hosts, and re-validates every redirect hop (see lib/url-guard).
    const chk = await assertSafeUrl(input.url);
    if (!chk.ok) return reply.code(chk.code).send({ error: chk.error, message: chk.message });

    const project = await prisma.project.findFirstOrThrow({
      where: { id: input.projectId, workspaceId },
    });

    // Fetch the audio (rights-cleared source) with a timeout + size cap.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
    let bytes: Buffer;
    let contentType: string;
    try {
      const res = await safeFetch(input.url, { signal: controller.signal });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return reply.code(502).send({ error: `source responded ${res.status}` });
      }
      contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared && declared > MAX_IMPORT_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        return reply.code(413).send({ error: 'file too large (max 80MB)' });
      }
      bytes = await readWithLimit(res, MAX_IMPORT_BYTES);
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 413) {
        return reply.code(413).send({ error: 'file too large (max 80MB)' });
      }
      // A redirect that pointed at a blocked/private host is rejected mid-fetch.
      const uc = (err as { urlCheck?: { code: number; error: string; message?: string } }).urlCheck;
      if (uc) return reply.code(uc.code).send({ error: uc.error, message: uc.message });
      // Log the real cause; give the client a safe, actionable message (raw
      // fetch errors can leak internal hostnames/stack details).
      req.log.warn({ err }, 'import fetch failed');
      return reply
        .code(502)
        .send({ error: 'fetch_failed', message: 'Could not fetch that URL — check it is a public, direct audio link and try again.' });
    } finally {
      clearTimeout(t);
    }

    // Always require audio — no exemption. (The old reference-kind bypass turned
    // /import into a fetch-any-content proxy that stored + read back non-audio.)
    if (!/^audio\//.test(contentType)) {
      return reply.code(415).send({
        error: 'not_audio',
        message: `Expected audio, got "${contentType}". Use a direct audio file link.`,
      });
    }

    const ext = extFromContentType(contentType, input.url);
    const detected = sniffAudioFormat(bytes.subarray(0, 64));
    if (!detected) return reply.code(415).send({ error: 'unsupported_or_invalid_audio' });
    if ((ext === 'm4a' ? 'm4a' : ext) !== detected) {
      return reply.code(415).send({ error: 'audio_type_mismatch', declared: ext, detected });
    }
    const key = `${workspaceId}/uploads/import-${input.kind}/${nanoid()}.${ext}`;
    const url = await putBytes(key, bytes, contentType);

    // Register the imported asset just like an upload — authentic, approved.
    if (input.kind === 'vocal') {
      const songId = input.songId ?? (await ensureSong(workspaceId, project.id, `${project.title} — import`));
      const { vocal, job } = await registerVocalForInspection({
        app,
        workspaceId,
        projectId: project.id,
        songId,
        role: input.role ?? 'lead',
        url,
        source: 'artist_import',
        sourceMeta: { imported: true, sourceUrl: provenanceUrl(input.url) },
      });
      reply.code(202);
      return { kind: 'vocal', asset: vocal, songId, jobId: job.jobId, qualityState: 'pending' };
    }

    if (input.kind === 'song') {
      // TRAINING-ONLY door (the owner found his old catalog track sitting in the
      // studio catalog after a training import): learn + harvest WITHOUT filing
      // a catalog Song/Mix — the lake and the shelf get everything, the catalog
      // stays the artist's working space.
      if (input.trainingOnly) {
        await enqueueLearn(app, { workspaceId, projectId: project.id, url, source: 'song-import-training' });
        await enqueueHarvest(app, { workspaceId, projectId: project.id, sourceUrl: url, owned: true });
        reply.code(201);
        return { kind: 'song', trainingOnly: true, url, note: 'Learned + harvested for training — not added to the catalog.' };
      }
      const songId = input.songId ?? (await ensureSong(workspaceId, project.id, input.title ?? `${project.title} — import`));
      const mix = await prisma.mix.create({
        data: {
          projectId: project.id, songId, preset: 'imported', url,
          notes: `Imported song — ${provenanceUrl(input.url)}`,
        },
      });
      // Same law as the finished-upload bridge (mixes.ts /upload): an OWNED
      // imported song both LEARNS (SoundReference, genre hint = project genre)
      // and HARVESTS (non-vocal stems → owned material). Song-scoped — a
      // finished record has no beat row. Best-effort, never blocks the import.
      await enqueueLearn(app, { workspaceId, projectId: project.id, url, source: 'song-import' });
      await enqueueHarvest(app, { workspaceId, projectId: project.id, songId, sourceUrl: url, owned: true });
      reply.code(201);
      return { kind: 'song', asset: mix, songId };
    }

    if (input.kind === 'reference') {
      reply.code(201);
      return { kind: 'reference', url, note: 'Stored for inspiration only — not added to the song.' };
    }

    // beat | instrumental
    const songId = input.songId ?? (await ensureSong(workspaceId, project.id, `${project.title} — import`));
    if (input.bpm || input.keySignature) {
      await prisma.project.update({
        where: { id: project.id },
        data: {
          ...(input.bpm ? { bpm: input.bpm } : {}),
          ...(input.keySignature ? { keySignature: input.keySignature } : {}),
        },
      });
    }
    const { beat, job } = await registerBeatForInspection({
      app,
      workspaceId,
      projectId: project.id,
      songId,
      url,
      format: ext,
      provider: 'import',
      bpm: input.bpm ?? null,
      keySignature: input.keySignature ?? null,
      sourceMeta: {
        imported: true,
        sourceUrl: provenanceUrl(input.url),
        instrumental: true,
        title: input.title ?? null,
        rightsBasis: 'user-attested',
      },
    });
    // Auto-harvest the owned import into reusable role loops (drums/bass/other).
    await enqueueHarvest(app, { workspaceId, projectId: project.id, beatId: beat.id, sourceUrl: url });
    // AUTO-LEARN too (audit: harvested but never learned): the owned import
    // joins the learned lake as a SoundReference. Charged; best-effort.
    await enqueueLearn(app, { workspaceId, projectId: project.id, url, source: 'beat-import' });
    reply.code(202);
    return { kind: input.kind, asset: beat, songId, jobId: job.jobId, qualityState: 'pending' };
  });
}
