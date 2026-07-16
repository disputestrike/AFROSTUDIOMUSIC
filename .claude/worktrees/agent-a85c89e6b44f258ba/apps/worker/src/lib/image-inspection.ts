import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface InspectedImage {
  width: number;
  height: number;
  pixelFormat: string | null;
  contentHash: string;
}

function ffprobeImage(path: string): Promise<{ width: number; height: number; pixelFormat: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,pix_fmt',
      '-of', 'json',
      path,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(new Error('image_probe_unavailable: ' + error.message)));
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error('image_decode_failed: ' + stderr.slice(0, 300)));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number; pix_fmt?: string }> };
        const stream = parsed.streams?.[0];
        const width = Number(stream?.width ?? 0);
        const height = Number(stream?.height ?? 0);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
          throw new Error('image dimensions missing');
        }
        resolve({ width, height, pixelFormat: stream?.pix_fmt ?? null });
      } catch (error) {
        reject(new Error('image_probe_invalid: ' + ((error as Error).message || 'invalid JSON')));
      }
    });
  });
}

export async function inspectImageBytes(bytes: Buffer, kind: string): Promise<InspectedImage> {
  if (bytes.byteLength < 1024 || bytes.byteLength > 50 * 1024 * 1024) {
    throw new Error('image_size_invalid');
  }
  const directory = await mkdtemp(join(tmpdir(), 'afrohit-image-qc-'));
  const path = join(directory, 'image.bin');
  try {
    await writeFile(path, bytes);
    const measured = await ffprobeImage(path);
    if (kind === 'cover' && (
      measured.width !== measured.height
      || measured.width < 1000
      || measured.height < 1000
    )) {
      throw new Error('cover_qc_failed: cover must be square and at least 1000x1000');
    }
    return {
      ...measured,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
