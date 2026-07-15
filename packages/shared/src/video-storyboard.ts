import type { CreditKey } from "./credits";

export interface NormalizedStoryboardShot {
  index: number;
  prompt: string;
  duration_s: number;
  motion?: string;
  lighting?: string;
  subjects?: string[];
  negativePrompt?: string;
}

const PROVIDER_DURATIONS = [4, 8, 12] as const;
const MAX_SHOTS = 15;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function providerDuration(value: unknown): number {
  const parsed = Number(value);
  const requested = Number.isFinite(parsed)
    ? Math.max(1, Math.min(12, Math.round(parsed)))
    : 4;
  return (
    PROVIDER_DURATIONS.find(duration => duration >= requested) ??
    PROVIDER_DURATIONS[PROVIDER_DURATIONS.length - 1]!
  );
}

/**
 * Treat model-authored storyboard JSON as untrusted. The normalized plan has a
 * finite shot count and provider-supported durations that never exceed the
 * duration the user approved.
 */
export function normalizeStoryboardShots(
  value: unknown,
  targetDurationS: number
): NormalizedStoryboardShot[] {
  if (!Array.isArray(value)) return [];
  const target = Math.max(8, Math.min(60, Math.floor(targetDurationS)));
  let remaining = target;
  const shots: NormalizedStoryboardShot[] = [];

  for (const item of value.slice(0, MAX_SHOTS)) {
    if (remaining < PROVIDER_DURATIONS[0]) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const prompt = cleanText(row.prompt, 2_000);
    if (!prompt) continue;

    const requested = providerDuration(row.duration_s);
    const duration =
      [...PROVIDER_DURATIONS]
        .reverse()
        .find(candidate => candidate <= requested && candidate <= remaining) ??
      PROVIDER_DURATIONS.find(candidate => candidate <= remaining);
    if (!duration) break;

    const subjects = Array.isArray(row.subjects)
      ? row.subjects
          .map(subject => cleanText(subject, 120))
          .filter((subject): subject is string => Boolean(subject))
          .slice(0, 8)
      : undefined;
    shots.push({
      index: shots.length,
      prompt,
      duration_s: duration,
      ...(cleanText(row.motion, 300)
        ? { motion: cleanText(row.motion, 300) }
        : {}),
      ...(cleanText(row.lighting, 300)
        ? { lighting: cleanText(row.lighting, 300) }
        : {}),
      ...(subjects?.length ? { subjects } : {}),
      ...(cleanText(row.negativePrompt, 500)
        ? { negativePrompt: cleanText(row.negativePrompt, 500) }
        : {}),
    });
    remaining -= duration;
  }

  return shots;
}

export interface VideoRenderUsage {
  creditKey: Extract<CreditKey, "video_8s" | "video_20s">;
  billingUnits: number;
  planUnits: number;
  shotCount: number;
}

/** Convert selected shots into the provider workload used for billing/caps. */
export function videoRenderUsage(
  shots: Array<{ duration_s?: number }>,
  shotIndex?: number
): VideoRenderUsage | null {
  if (shots.length === 0 || shots.length > MAX_SHOTS) return null;
  const selected =
    shotIndex == null ? shots : shots[shotIndex] ? [shots[shotIndex]!] : [];
  if (!selected.length) return null;

  const durations = selected.map(shot => providerDuration(shot.duration_s));
  const planUnits = durations.reduce((sum, duration) => sum + duration, 0);
  if (!Number.isInteger(planUnits) || planUnits <= 0) return null;
  const creditKey = planUnits <= 8 ? "video_8s" : "video_20s";
  const billingUnits =
    creditKey === "video_8s"
      ? Math.ceil(planUnits / 8)
      : Math.ceil(planUnits / 20);
  return { creditKey, billingUnits, planUnits, shotCount: selected.length };
}
