export function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = canonicalizeJson(item);
      return normalized === undefined ? null : normalized;
    });
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = canonicalizeJson((value as Record<string, unknown>)[key]);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  }
  return undefined;
}

/** Recursively stable JSON used for hashes, idempotency fingerprints, and receipts. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}
