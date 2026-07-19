type Environment = Record<string, string | undefined>;

export interface WorkerFeatureReadiness {
  ready: boolean;
  liveSafe: boolean;
  provider: string;
  missing: string[];
  issues: string[];
}

function has(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function veoReadiness(env: Environment): Pick<
  WorkerFeatureReadiness,
  "ready" | "missing" | "issues"
> {
  const encoded = env.GCP_SERVICE_ACCOUNT_JSON_B64?.trim();
  const missing: string[] = [];
  const issues: string[] = [];
  let accountProject = "";
  if (!encoded) {
    missing.push("GCP_SERVICE_ACCOUNT_JSON_B64");
  } else {
    try {
      const parsed = JSON.parse(
        Buffer.from(encoded, "base64").toString("utf8")
      ) as Record<string, unknown>;
      const email = typeof parsed.client_email === "string" ? parsed.client_email : "";
      const key = typeof parsed.private_key === "string" ? parsed.private_key : "";
      accountProject =
        typeof parsed.project_id === "string" ? parsed.project_id.trim() : "";
      if (!email.includes("@")) issues.push("GCP service account email is invalid");
      if (!key.includes("BEGIN PRIVATE KEY"))
        issues.push("GCP service account private key is invalid");
    } catch {
      issues.push("GCP_SERVICE_ACCOUNT_JSON_B64 is not valid base64 JSON");
    }
  }
  const project = (env.GCP_PROJECT_ID ?? accountProject).trim();
  if (!project) missing.push("GCP_PROJECT_ID or service-account project_id");
  else if (!/^[a-z][a-z0-9-]{4,62}$/.test(project))
    issues.push("GCP project ID is invalid");
  return { ready: !missing.length && !issues.length, missing, issues };
}

export function workerVideoProviderReadiness(options: {
  provider: string;
  workspaceReplicateKey?: string;
  useLikeness?: boolean;
  imageToVideo?: boolean;
  env?: Environment;
}): WorkerFeatureReadiness {
  const env = options.env ?? process.env;
  const provider = options.provider.trim().toLowerCase();
  const token =
    options.workspaceReplicateKey?.trim() ||
    env.REPLICATE_API_TOKEN?.trim() ||
    env.REPLICATE_TOKEN?.trim();
  const tierProvider = new Set(["wan", "hailuo", "kling"]).has(provider);
  let ready = false;
  let liveSafe = false;
  let missing: string[] = [];
  let issues: string[] = [];

  if (tierProvider) {
    ready = Boolean(token);
    liveSafe = ready;
    if (!ready) missing = ["REPLICATE_API_TOKEN or workspace Replicate key"];
  } else if (provider === "sora") {
    ready = has(env.OPENAI_API_KEY);
    liveSafe = ready;
    if (!ready) missing = ["OPENAI_API_KEY"];
  } else if (provider === "veo") {
    const veo = veoReadiness(env);
    ready = veo.ready;
    liveSafe = ready;
    missing = veo.missing;
    issues = veo.issues;
  } else if (provider === "stub") {
    ready = env.NODE_ENV !== "production" && env.ALLOW_STUB_AUDIO === "1";
    liveSafe = false;
    if (!ready) missing = ["a live video provider"];
    issues = ["development stub is never live-safe"];
  } else {
    missing = ["a supported video provider"];
    issues = [`unsupported video provider: ${provider || "unavailable"}`];
  }

  if (options.useLikeness && options.imageToVideo !== true) {
    ready = false;
    liveSafe = false;
    issues.push("selected provider cannot render from a likeness keyframe");
  }
  return { ready, liveSafe, provider, missing, issues };
}

export function workerRuntimeReadiness(
  env: Environment = process.env
): {
  video: WorkerFeatureReadiness;
  likenessTraining: WorkerFeatureReadiness;
} {
  const provider = has(env.REPLICATE_API_TOKEN) || has(env.REPLICATE_TOKEN)
    ? "hailuo"
    : (env.VIDEO_PROVIDER ?? "unavailable").trim().toLowerCase();
  const video = workerVideoProviderReadiness({ provider, env });
  const likenessMissing: string[] = [];
  if (env.LIKENESS_TRAINING_ENABLED !== "1")
    likenessMissing.push("LIKENESS_TRAINING_ENABLED=1");
  if (!has(env.REPLICATE_API_TOKEN) && !has(env.REPLICATE_TOKEN))
    likenessMissing.push("REPLICATE_API_TOKEN");
  if (!has(env.LIKENESS_LORA_DESTINATION) && !has(env.REPLICATE_USERNAME))
    likenessMissing.push("LIKENESS_LORA_DESTINATION or REPLICATE_USERNAME");
  const likenessReady = likenessMissing.length === 0;
  return {
    video,
    likenessTraining: {
      ready: likenessReady,
      liveSafe: likenessReady,
      provider: "replicate",
      missing: likenessMissing,
      issues: [],
    },
  };
}

export function publicWorkerRuntimeReadiness(
  report: ReturnType<typeof workerRuntimeReadiness>
) {
  return {
    video: report.video.ready && report.video.liveSafe,
    likenessTraining:
      report.likenessTraining.ready && report.likenessTraining.liveSafe,
  };
}
