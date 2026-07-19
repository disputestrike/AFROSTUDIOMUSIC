import { distributionConfigurationStatus } from "./distribution";

export type VideoEngineClass = "draft" | "standard" | "flagship";

type Environment = Record<string, string | undefined>;

export interface FeatureReadiness {
  ready: boolean;
  liveSafe: boolean;
  selected: string;
  source: "workspace" | "environment" | "development" | "none";
  missing: string[];
  issues: string[];
}

export interface RuntimeReadinessReport {
  checkedAt: string;
  video: FeatureReadiness;
  likenessTraining: FeatureReadiness;
  distribution: FeatureReadiness;
}

const TIER_PROVIDER: Record<VideoEngineClass, string> = {
  draft: "wan",
  standard: "hailuo",
  flagship: "kling",
};

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function decodeVeoServiceAccount(env: Environment): {
  ok: boolean;
  projectId: string | null;
  missing: string[];
  issues: string[];
} {
  const encoded = env.GCP_SERVICE_ACCOUNT_JSON_B64?.trim();
  if (!encoded) {
    return {
      ok: false,
      projectId: null,
      missing: ["GCP_SERVICE_ACCOUNT_JSON_B64"],
      issues: [],
    };
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8")
    ) as Record<string, unknown>;
    const email =
      typeof parsed.client_email === "string" ? parsed.client_email.trim() : "";
    const privateKey =
      typeof parsed.private_key === "string" ? parsed.private_key.trim() : "";
    const projectId =
      typeof parsed.project_id === "string" ? parsed.project_id.trim() : null;
    const issues: string[] = [];
    if (!email || !email.includes("@"))
      issues.push("GCP service account email is missing or invalid");
    if (!privateKey.includes("BEGIN PRIVATE KEY"))
      issues.push("GCP service account private key is missing or invalid");
    return { ok: issues.length === 0, projectId, missing: [], issues };
  } catch {
    return {
      ok: false,
      projectId: null,
      missing: [],
      issues: ["GCP_SERVICE_ACCOUNT_JSON_B64 is not valid base64 JSON"],
    };
  }
}

function legacyVideoProviderReadiness(
  env: Environment
): FeatureReadiness {
  const selected = (env.VIDEO_PROVIDER ?? "unavailable").trim().toLowerCase();
  if (selected === "sora") {
    const missing = configured(env.OPENAI_API_KEY) ? [] : ["OPENAI_API_KEY"];
    return {
      ready: missing.length === 0,
      liveSafe: missing.length === 0,
      selected,
      source: "environment",
      missing,
      issues: [],
    };
  }

  if (selected === "veo") {
    const account = decodeVeoServiceAccount(env);
    const project = (env.GCP_PROJECT_ID ?? account.projectId ?? "").trim();
    const location = (env.GCP_LOCATION ?? "us-central1").trim();
    const model = (env.VEO_MODEL ?? "veo-3.1-fast-generate-001").trim();
    const resolution = (env.VEO_RESOLUTION ?? "720p").trim();
    const missing = [...account.missing];
    const issues = [...account.issues];
    if (!project) missing.push("GCP_PROJECT_ID or service-account project_id");
    else if (!/^[a-z][a-z0-9-]{4,62}$/.test(project))
      issues.push("GCP project ID is invalid");
    if (!/^[a-z0-9-]{2,30}$/.test(location))
      issues.push("GCP location is invalid");
    if (!/^veo-[a-z0-9.-]+$/.test(model))
      issues.push("Veo model name is invalid");
    if (!new Set(["720p", "1080p"]).has(resolution))
      issues.push("Veo resolution must be 720p or 1080p");
    const ready = account.ok && missing.length === 0 && issues.length === 0;
    return {
      ready,
      liveSafe: ready,
      selected,
      source: "environment",
      missing,
      issues,
    };
  }

  if (selected === "stub") {
    const allowed =
      env.NODE_ENV !== "production" && env.ALLOW_STUB_AUDIO === "1";
    return {
      ready: allowed,
      liveSafe: false,
      selected,
      source: allowed ? "development" : "none",
      missing: allowed ? [] : ["a live VIDEO_PROVIDER"],
      issues: allowed
        ? ["development stub is configured; it is never live-safe"]
        : ["video stub is disabled outside explicit development mode"],
    };
  }

  return {
    ready: false,
    liveSafe: false,
    selected: selected || "unavailable",
    source: "none",
    missing: ["VIDEO_PROVIDER and its credentials"],
    issues: selected && selected !== "unavailable"
      ? [`unsupported VIDEO_PROVIDER: ${selected}`]
      : [],
  };
}

export function resolveVideoProviderReadiness(options: {
  engineClass: VideoEngineClass;
  useLikeness?: boolean;
  workspaceReplicateKey?: string;
  env?: Environment;
}): FeatureReadiness {
  const env = options.env ?? process.env;
  const workspaceToken = options.workspaceReplicateKey?.trim();
  const environmentToken =
    env.REPLICATE_API_TOKEN?.trim() || env.REPLICATE_TOKEN?.trim();
  const token = workspaceToken || environmentToken;

  if (token) {
    const i2vEnv =
      options.engineClass === "draft"
        ? "REPLICATE_VIDEO_DRAFT_I2V_MODEL"
        : options.engineClass === "flagship"
          ? "REPLICATE_VIDEO_FLAGSHIP_I2V_MODEL"
          : "REPLICATE_VIDEO_STANDARD_I2V_MODEL";
    const imageToVideoDisabled = env[i2vEnv] === "";
    const issues =
      options.useLikeness && imageToVideoDisabled
        ? [`${i2vEnv} disables the image-to-video path required by likeness`]
        : [];
    return {
      ready: issues.length === 0,
      liveSafe: issues.length === 0,
      selected: TIER_PROVIDER[options.engineClass],
      source: workspaceToken ? "workspace" : "environment",
      missing: [],
      issues,
    };
  }

  const legacy = legacyVideoProviderReadiness(env);
  if (options.useLikeness) {
    return {
      ...legacy,
      ready: false,
      liveSafe: false,
      missing: [...legacy.missing, "REPLICATE_API_TOKEN or workspace Replicate key"],
      issues: [
        ...legacy.issues,
        "likeness video requires an image-to-video engine; Veo/Sora legacy adapters are text-to-video only",
      ],
    };
  }
  return legacy;
}

export function runtimeReadinessReport(
  env: Environment = process.env
): RuntimeReadinessReport {
  const video = resolveVideoProviderReadiness({
    engineClass: "standard",
    env,
  });
  const likenessMissing: string[] = [];
  const likenessIssues: string[] = [];
  if (env.LIKENESS_TRAINING_ENABLED !== "1")
    likenessMissing.push("LIKENESS_TRAINING_ENABLED=1");
  if (!configured(env.REPLICATE_API_TOKEN) && !configured(env.REPLICATE_TOKEN))
    likenessMissing.push("REPLICATE_API_TOKEN");
  if (!configured(env.LIKENESS_LORA_DESTINATION) && !configured(env.REPLICATE_USERNAME))
    likenessMissing.push("LIKENESS_LORA_DESTINATION or REPLICATE_USERNAME");
  const likenessReady = likenessMissing.length === 0 && likenessIssues.length === 0;
  const distribution = distributionConfigurationStatus(env);

  return {
    checkedAt: new Date().toISOString(),
    video,
    likenessTraining: {
      ready: likenessReady,
      liveSafe: likenessReady,
      selected: "replicate",
      source: likenessReady ? "environment" : "none",
      missing: likenessMissing,
      issues: likenessIssues,
    },
    distribution: {
      ready: distribution.ready,
      liveSafe: distribution.ready && distribution.inboundWebhookReady,
      selected: distribution.provider,
      source: distribution.ready ? "environment" : "none",
      missing: distribution.missing,
      issues: distribution.issues,
    },
  };
}

export function publicRuntimeReadiness(report: RuntimeReadinessReport) {
  return {
    video: report.video.ready && report.video.liveSafe,
    likenessTraining:
      report.likenessTraining.ready && report.likenessTraining.liveSafe,
    distribution:
      report.distribution.ready && report.distribution.liveSafe,
  };
}
