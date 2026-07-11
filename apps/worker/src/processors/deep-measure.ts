/**
 * DEEP MEASURE — the slow half of the ear, off the interactive path.
 *
 * The Listen flow got 10x slower when Demucs stem separation went default-ON
 * inside the synchronous analyze (July 8 cost-gates). Fix: analyze measures
 * FULL-MIX (seconds) and enqueues this job; this runs stems + refined DSP in
 * the background and upgrades the stored reference in place. Same stem-grade
 * log-drum facts, nobody waiting on a stepper. Idempotent via recipe.deepMeasured.
 */
import { prisma } from '@afrohit/db';
import { separateStemsRouted } from '../lib/demucs-local';
import { measureAudio, dspAvailable, type StemInputs } from '../lib/dsp';

export interface DeepMeasurePayload {
  referenceId: string; url: string; workspaceId: string;
  /** Facts-only references: delete the audio once the deep read lands (the lake
   *  keeps NUMBERS, never a copy of a record the artist didn't make). */
  purgeAfter?: boolean;
}

export async function processDeepMeasure(p: DeepMeasurePayload): Promise<void> {
  try {
    if (!(await dspAvailable())) return;
    const ref = await prisma.soundReference.findUnique({ where: { id: p.referenceId }, select: { recipe: true } });
    if (!ref) return;
    const recipe = (ref.recipe ?? {}) as Record<string, unknown> & { deepMeasured?: boolean };
    if (recipe.deepMeasured) return;

    let stems: StemInputs | undefined;
    let sourceGone = false;
    if (process.env.DSP_STEMS !== '0') {
      try {
        const ws = await prisma.workspace.findUnique({ where: { id: p.workspaceId }, select: { musicApiKey: true } });
        // A3-4: nightly/backfill separation runs LOCAL by default (≈$0) — the
        // paid path is the fallback, not the habit.
        const sep = await separateStemsRouted({ audioUrl: p.url, mode: 'full', apiKey: ws?.musicApiKey ?? undefined, purpose: 'measure', workspaceId: p.workspaceId });
        const byRole = (r: string) => sep.stems.find((s) => s.role === r)?.url;
        stems = { bass: byRole('bass'), drums: byRole('drums'), other: byRole('other'), vocals: byRole('vocals') };
      } catch (e) {
        const msg = (e as Error)?.message ?? '';
        // A 404/not-found means the source audio is PERMANENTLY gone from storage
        // (deleted, expired, or a purged facts-only ref). measureAudio would 404
        // too — no point trying, and the nightly backfill must stop re-queuing it.
        if (/\b404\b|not found|no such|does not exist|nosuchkey/i.test(msg)) sourceGone = true;
        console.warn('[deep-measure] stems failed — full-mix refine only:', msg);
      }
    }

    // TOMBSTONE: the file is gone. Mark the ref so the backfill selector skips it
    // forever instead of hammering the same 404 every nightly run.
    if (sourceGone) {
      await prisma.soundReference.update({
        where: { id: p.referenceId },
        data: { recipe: { ...recipe, deepMeasured: true, audioMissing: true, deepMeasureError: 'source audio 404 — no longer in storage', deepMeasuredAt: new Date().toISOString() } as never },
      }).catch(() => {});
      console.warn(`[deep-measure] ref ${p.referenceId} tombstoned — source audio gone (404); will not retry`);
      return;
    }

    const measured = await measureAudio(p.url, stems);
    if (!measured.engineOk) {
      // Not a clean 404, but still unmeasurable. Count the miss and give up after
      // 3 tries so a quietly-broken ref can't spin the backfill indefinitely.
      const attempts = ((recipe.deepMeasureAttempts as number) ?? 0) + 1;
      const patch: Record<string, unknown> = { ...recipe, deepMeasureAttempts: attempts };
      if (attempts >= 3) { patch.deepMeasured = true; patch.audioMissing = true; patch.deepMeasureError = `measure failed ${attempts}× — giving up`; }
      await prisma.soundReference.update({ where: { id: p.referenceId }, data: { recipe: patch as never } }).catch(() => {});
      return; // never overwrite a good read with an engine failure
    }
    await prisma.soundReference.update({
      where: { id: p.referenceId },
      data: { recipe: { ...recipe, measured, deepMeasured: true, deepMeasuredAt: new Date().toISOString() } as never },
    });
    console.log(`[deep-measure] ref ${p.referenceId} upgraded (stems=${!!stems?.bass})`);
    if (p.purgeAfter) {
      const { deleteObjectByUrl } = await import('../lib/storage');
      await deleteObjectByUrl(p.url).catch(() => {});
      console.log(`[deep-measure] purged facts-only audio for ref ${p.referenceId}`);
    }
  } catch (err) {
    console.warn('[deep-measure] failed (non-fatal):', (err as Error)?.message);
  }
}
