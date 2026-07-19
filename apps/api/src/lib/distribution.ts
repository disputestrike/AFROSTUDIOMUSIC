import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@afrohit/shared";
import { assertSafeUrl, safeFetch } from "./url-guard";

export interface DistributeRelease {
  releaseId: string;
  revision: number;
  title: string;
  artist: string;
  genre?: string | null;
  isrc?: string | null;
  upc?: string | null;
  audioAssetId: string;
  audioAssetKind: "master" | "mix";
  coverAssetId: string;
  exportId: string;
  artifactFingerprint: string;
  audioUrl: string;
  coverUrl: string;
  bundleUrl: string;
  evidenceHash: string;
  idempotencyKey: string;
}

export interface DistributeResult {
  status: "submitted" | "not_configured" | "failed";
  provider: string;
  message: string;
  externalId?: string;
  partnerStatus?: "submitted" | "accepted";
  channels?: Record<string, string>;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 25_000;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function distributionSignature(
  secret: string,
  timestamp: string,
  body: string | Uint8Array
): string {
  return (
    "sha256=" +
    createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(body)
      .digest("hex")
  );
}

export function verifyDistributionSignature(input: {
  secret: string;
  timestamp: string;
  signature: string;
  body: string | Uint8Array;
  nowSeconds?: number;
}): boolean {
  if (Buffer.byteLength(input.secret) < 32) return false;
  if (!/^\d{10}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const expected = Buffer.from(
    distributionSignature(input.secret, input.timestamp, input.body),
    "utf8"
  );
  const actual = Buffer.from(input.signature, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBoundedJson(
  response: Response
): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES)
    throw new Error("distribution_response_too_large");
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel("distribution_response_too_large");
      throw new Error("distribution_response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("distribution_response_invalid");
  }
  return parsed as Record<string, unknown>;
}

export function sanitizeDistributionChannels(
  value: unknown
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const channels: Record<string, string> = {};
  for (const [name, rawUrl] of Object.entries(value)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(name) || typeof rawUrl !== "string")
      continue;
    try {
      const url = new URL(rawUrl);
      if (url.protocol === "https:" && !url.username && !url.password)
        channels[name] = url.toString();
    } catch {
      // Ignore malformed channel URLs from the partner response.
    }
  }
  return Object.keys(channels).length ? channels : undefined;
}

type Environment = Record<string, string | undefined>;

export interface DistributionConfigurationStatus {
  ready: boolean;
  provider: string;
  endpointConfigured: boolean;
  endpointHost: string | null;
  signingSecretConfigured: boolean;
  signingSecretStrong: boolean;
  inboundWebhookReady: boolean;
  missing: string[];
  issues: string[];
}

export function distributionConfigurationStatus(
  env: Environment = process.env
): DistributionConfigurationStatus {
  const provider = (env.DISTRIBUTOR ?? "partner").trim().toLowerCase();
  const endpoint = env.DISTRIBUTOR_WEBHOOK_URL?.trim() ?? "";
  const secret = env.DISTRIBUTOR_WEBHOOK_SECRET ?? "";
  const missing: string[] = [];
  const issues: string[] = [];
  let endpointHost: string | null = null;
  if (!endpoint) {
    missing.push("DISTRIBUTOR_WEBHOOK_URL");
  } else {
    try {
      const parsed = new URL(endpoint);
      endpointHost = parsed.host || null;
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password
      ) {
        issues.push("distributor endpoint must be credential-free HTTPS");
      }
    } catch {
      issues.push("distributor endpoint is not a valid URL");
    }
  }
  const signingSecretConfigured = Buffer.byteLength(secret) > 0;
  const signingSecretStrong = Buffer.byteLength(secret) >= 32;
  if (!signingSecretConfigured) missing.push("DISTRIBUTOR_WEBHOOK_SECRET");
  else if (!signingSecretStrong)
    issues.push("distributor signing secret must contain at least 32 bytes");
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(provider))
    issues.push("DISTRIBUTOR contains an invalid provider label");
  const ready = missing.length === 0 && issues.length === 0;
  return {
    ready,
    provider,
    endpointConfigured: Boolean(endpoint),
    endpointHost,
    signingSecretConfigured,
    signingSecretStrong,
    inboundWebhookReady: signingSecretStrong,
    missing,
    issues,
  };
}

export function distributionLifecycleDiagnostics(
  release: {
    status: string;
    distributor?: string | null;
    externalId?: string | null;
    distributionStatusAt?: Date | null;
    submittedAt?: Date | null;
    liveAt?: Date | null;
  } | null,
  configuration: DistributionConfigurationStatus,
  now = new Date()
) {
  if (!release) {
    return {
      healthy: configuration.ready,
      state: "not_created",
      stale: false,
      lastStatusAt: null,
      issues: configuration.ready ? [] : ["distribution is not configured"],
    };
  }
  const issues: string[] = [];
  const partnerState = new Set(["submitted", "accepted", "live"]).has(
    release.status
  );
  if (partnerState && !release.externalId)
    issues.push("partner state is missing an external release ID");
  if (partnerState && !release.distributor)
    issues.push("partner state is missing the distributor label");
  if (release.status === "live" && !release.liveAt)
    issues.push("live state is missing its live timestamp");
  const lastStatusAt =
    release.distributionStatusAt ?? release.submittedAt ?? null;
  const ageMs = lastStatusAt ? now.getTime() - lastStatusAt.getTime() : null;
  const stale =
    (release.status === "submitting" &&
      (ageMs === null || ageMs > 10 * 60_000)) ||
    ((release.status === "submitted" || release.status === "accepted") &&
      (ageMs === null || ageMs > 7 * 24 * 60 * 60_000));
  if (stale) issues.push(`distribution state ${release.status} is stale`);
  if (!configuration.inboundWebhookReady && partnerState)
    issues.push("partner status webhooks are not ready");
  return {
    healthy: configuration.ready && issues.length === 0,
    state: release.status,
    stale,
    lastStatusAt,
    issues,
  };
}

export function distributionSubmissionPayload(
  release: DistributeRelease,
  provider: string
) {
  return {
    schemaVersion: 1,
    event: "release.submit",
    provider,
    release: {
      releaseId: release.releaseId,
      revision: release.revision,
      title: release.title,
      artist: release.artist,
      genre: release.genre ?? null,
      isrc: release.isrc ?? null,
      upc: release.upc ?? null,
      audioUrl: release.audioUrl,
      coverUrl: release.coverUrl,
      bundleUrl: release.bundleUrl,
      evidenceHash: release.evidenceHash,
      artifactFingerprint: release.artifactFingerprint,
      assets: {
        audio: {
          id: release.audioAssetId,
          kind: release.audioAssetKind,
        },
        cover: { id: release.coverAssetId },
        export: { id: release.exportId },
      },
    },
  };
}

/**
 * Real distribution handoff contract.
 *
 * The configured HTTPS endpoint belongs to an approved distributor integration
 * or private automation that translates this signed payload into the partner's
 * upload API. No endpoint means no submission; there is no fake success path.
 */
export async function distributeRelease(
  release: DistributeRelease
): Promise<DistributeResult> {
  const configuration = distributionConfigurationStatus();
  const provider = configuration.provider;
  const endpoint = process.env.DISTRIBUTOR_WEBHOOK_URL?.trim();
  const secret = process.env.DISTRIBUTOR_WEBHOOK_SECRET ?? "";

  if (!configuration.ready) {
    const notConfigured = configuration.missing.length > 0;
    return {
      status: notConfigured ? "not_configured" : "failed",
      provider,
      message: notConfigured
        ? `Distribution is missing: ${configuration.missing.join(", ")}.`
        : configuration.issues.join("; ").slice(0, 300),
    };
  }

  // Narrowing after the configuration gate; kept explicit for TypeScript and
  // to prevent a future refactor from sending to an absent endpoint.
  if (!endpoint || !secret) throw new Error("distribution configuration drift");

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return {
      status: "failed",
      provider,
      message: "Distributor endpoint is not a valid URL.",
    };
  }
  if (
    parsedEndpoint.protocol !== "https:" ||
    parsedEndpoint.username ||
    parsedEndpoint.password
  ) {
    return {
      status: "failed",
      provider,
      message: "Distributor endpoint must be credential-free HTTPS.",
    };
  }
  const urlCheck = await assertSafeUrl(endpoint, { blockMediaHosts: false });
  if (!urlCheck.ok) {
    return {
      status: "failed",
      provider,
      message: "Distributor endpoint failed the network safety check.",
    };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = distributionSubmissionPayload(release, provider);
  const body = canonicalJson(payload);
  const signature = distributionSignature(secret, timestamp, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await safeFetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      blockMediaHosts: false,
      maxHops: 0,
      headers: {
        "content-type": "application/json",
        "user-agent": "AfroHit-Distributor/1.0",
        "x-afrohit-timestamp": timestamp,
        "x-afrohit-signature": signature,
        "idempotency-key": release.idempotencyKey,
      },
      body,
    });
    const result = await readBoundedJson(response);
    if (!response.ok) {
      return {
        status: "failed",
        provider,
        message:
          typeof result.message === "string"
            ? result.message.slice(0, 300)
            : `Distributor returned HTTP ${response.status}.`,
      };
    }
    const externalId =
      typeof result.externalId === "string"
        ? result.externalId.trim().slice(0, 200)
        : "";
    const accepted =
      result.status === "submitted" || result.status === "accepted";
    if (!accepted || !externalId) {
      return {
        status: "failed",
        provider,
        message:
          "Distributor response did not confirm a submitted release with an external ID.",
      };
    }
    return {
      status: "submitted",
      provider,
      externalId,
      partnerStatus: result.status === "accepted" ? "accepted" : "submitted",
      channels: sanitizeDistributionChannels(result.channels),
      message:
        typeof result.message === "string"
          ? result.message.slice(0, 300)
          : "Release accepted by the configured distributor.",
    };
  } catch (error) {
    return {
      status: "failed",
      provider,
      message:
        (error as Error).name === "AbortError"
          ? "Distributor request timed out."
          : "Distributor request failed before a confirmed submission.",
    };
  } finally {
    clearTimeout(timer);
  }
}
