export type RuntimeEnvironment = Record<string, string | undefined>;

const PROVIDER_KEYS = [
  "MUSIC_PROVIDER",
  "VOICE_PROVIDER",
  "VIDEO_PROVIDER",
  "IMAGE_PROVIDER",
] as const;

export function productionRuntimeViolations(env: RuntimeEnvironment): string[] {
  if (env.NODE_ENV !== "production") return [];

  const violations: string[] = [];
  if (env.STUB_AI === "1") violations.push("STUB_AI=1");
  if (env.ALLOW_STUB_AUDIO === "1") violations.push("ALLOW_STUB_AUDIO=1");

  for (const key of PROVIDER_KEYS) {
    if (env[key]?.trim().toLowerCase() === "stub")
      violations.push(`${key}=stub`);
  }
  return violations;
}

export function assertProductionRuntimeSafety(env: RuntimeEnvironment): void {
  const violations = productionRuntimeViolations(env);
  if (violations.length) {
    throw new Error(
      `REFUSING TO BOOT: production placeholder modes are forbidden (${violations.join(", ")})`
    );
  }
}
