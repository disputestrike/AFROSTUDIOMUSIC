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
import { separateStems } from '@afrohit/ai';
import { measureAudio, dspAvailable, type StemInputs } from '../lib/dsp';

export interface DeepMeasurePayload { referenceId: string; url: string; workspaceId: string }

export async function processDeepMeasure(p: DeepMeasurePayload): Promise<void> {
  try {
    if (!(await dspAvailable())) return;
    const ref = await prisma.soundReference.findUnique({ where: { id: p.referenceId }, select: { recipe: true } });
    if (!ref) return;
    const recipe = (ref.recipe ?? {}) as Record<string, unknown> & { deepMeasured?: boolean };
    if (recipe.deepMeasured) return;

    let stems: StemInputs | undefined;
    if (process.env.DSP_STEMS !== '0') {
      try {
        const ws = await prisma.workspace.findUnique({ where: { id: p.workspaceId }, select: { musicApiKey: true } });
        const sep = await separateStems({ audioUrl: p.url, mode: 'full', apiKey: ws?.musicApiKey ?? undefined });
        const byRole = (r: string) => sep.stems.find((s) => s.role === r)?.url;
        stems = { bass: byRole('bass'), drums: byRole('drums'), other: byRole('other'), vocals: byRole('vocals') };
      } catch (e) {
        console.warn('[deep-measure] stems failed — full-mix refine only:', (e as Error)?.message);
      }
    }

    const measured = await measureAudio(p.url, stems);
    if (!measured.engineOk) return; // never overwrite a good read with an engine failure
    await prisma.soundReference.update({
      where: { id: p.referenceId },
      data: { recipe: { ...recipe, measured, deepMeasured: true, deepMeasuredAt: new Date().toISOString() } as never },
    });
    console.log(`[deep-measure] ref ${p.referenceId} upgraded (stems=${!!stems?.bass})`);
  } catch (err) {
    console.warn('[deep-measure] failed (non-fatal):', (err as Error)?.message);
  }
}
