import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { presignUploadSchema, importUrlSchema } from '@afrohit/shared';
import { nanoid } from 'nanoid';
import { requireAuth } from '../middleware/auth';
import { presignUpload, putBytes } from '../lib/storage';

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

// Hosts whose audio is DRM'd / copyrighted catalog — refuse with a clear reason.
const BLOCKED_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com',
  'spotify.com', 'scdn.co',
  'soundcloud.com', 'sndcdn.com',
  'tidal.com', 'deezer.com', 'audiomack.com',
  'music.apple.com', 'itunes.apple.com',
  'tiktok.com', 'instagram.com', 'facebook.com', 'fbcdn.net',
];

const MAX_IMPORT_BYTES = 80 * 1024 * 1024; // 80 MB
const IMPORT_TIMEOUT_MS = 30_000;

function hostIsBlocked(host: string): boolean {
  const h = host.toLowerCase();
  return BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

// Basic SSRF guard: only http/https, no localhost / private / link-local hosts.
// (Full protection would resolve DNS + block private IPs — hardening follow-up.)
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('127.') || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
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
    const { kind, contentType, ext } = presignUploadSchema.parse(req.body);
    return presignUpload({ workspaceId, kind: `uploads/${kind}`, contentType, ext });
  });

  app.post('/import', { schema: { body: importUrlSchema } }, async (req, reply) => {
    const { workspaceId } = requireAuth(req);
    const input = importUrlSchema.parse(req.body);

    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return reply.code(400).send({ error: 'invalid_url' });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reply.code(400).send({ error: 'only http(s) urls are allowed' });
    }
    if (isPrivateHost(parsed.hostname)) {
      return reply.code(400).send({ error: 'that host is not allowed' });
    }
    if (hostIsBlocked(parsed.hostname)) {
      return reply.code(422).send({
        error: 'copyrighted_source',
        message:
          "Can't pull from streaming platforms (YouTube/Spotify/SoundCloud/etc.) — that's copyrighted catalog and would get your release taken down. Import your own files, direct audio links, or royalty-free / Creative-Commons sources instead.",
      });
    }

    const project = await prisma.project.findFirstOrThrow({
      where: { id: input.projectId, workspaceId },
    });

    // Fetch the audio (rights-cleared source) with a timeout + size cap.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
    let bytes: Buffer;
    let contentType: string;
    try {
      const res = await fetch(input.url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) return reply.code(502).send({ error: `source responded ${res.status}` });
      contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared && declared > MAX_IMPORT_BYTES) {
        return reply.code(413).send({ error: 'file too large (max 80MB)' });
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_IMPORT_BYTES) {
        return reply.code(413).send({ error: 'file too large (max 80MB)' });
      }
      bytes = Buffer.from(ab);
    } catch (err) {
      return reply
        .code(502)
        .send({ error: 'fetch_failed', message: (err as Error).message.slice(0, 200) });
    } finally {
      clearTimeout(t);
    }

    if (!/^audio\//.test(contentType) && input.kind !== 'reference') {
      return reply.code(415).send({
        error: 'not_audio',
        message: `Expected audio, got "${contentType}". Use a direct audio file link.`,
      });
    }

    const ext = extFromContentType(contentType, input.url);
    const key = `${workspaceId}/uploads/import-${input.kind}/${nanoid()}.${ext}`;
    const url = await putBytes(key, bytes, contentType);

    // Register the imported asset just like an upload — authentic, approved.
    if (input.kind === 'vocal') {
      const songId = input.songId ?? (await ensureSong(workspaceId, project.id, `${project.title} — import`));
      const vocal = await prisma.vocalRender.create({
        data: {
          projectId: project.id, songId, role: input.role ?? 'lead', url,
          approved: true, meta: { imported: true, sourceUrl: input.url },
        },
      });
      reply.code(201);
      return { kind: 'vocal', asset: vocal, songId };
    }

    if (input.kind === 'song') {
      const songId = input.songId ?? (await ensureSong(workspaceId, project.id, input.title ?? `${project.title} — import`));
      const mix = await prisma.mix.create({
        data: {
          projectId: project.id, songId, preset: 'imported', url,
          notes: `Imported song — ${input.url}`,
        },
      });
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
    const beat = await prisma.beatAsset.create({
      data: {
        projectId: project.id, songId, url, format: ext,
        bpm: input.bpm ?? null, keySignature: input.keySignature ?? null,
        provider: 'import', approved: true,
        meta: {
          imported: true, sourceUrl: input.url,
          instrumental: input.kind === 'instrumental',
          title: input.title ?? null,
        },
      },
    });
    reply.code(201);
    return { kind: input.kind, asset: beat, songId };
  });
}
