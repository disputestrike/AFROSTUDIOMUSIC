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
  const provider = (process.env.DISTRIBUTOR ?? "partner").trim().toLowerCase();
  const endpoint = process.env.DISTRIBUTOR_WEBHOOK_URL?.trim();
  const secret = process.env.DISTRIBUTOR_WEBHOOK_SECRET ?? "";

  if (!endpoint || !secret) {
    return {
      status: "not_configured",
      provider,
      message:
        "Connect an approved distributor endpoint and signing secret before submitting releases.",
    };
  }
  if (Buffer.byteLength(secret) < 32) {
    return {
      status: "failed",
      provider,
      message: "Distributor signing secret must contain at least 32 bytes.",
    };
  }

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
