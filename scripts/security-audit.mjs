import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { satisfies, valid } from "semver";
import { parse } from "yaml";

const AUDIT_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const SEVERITY = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
});

export function parsePackageCoordinate(rawKey) {
  const key = rawKey.startsWith("/") ? rawKey.slice(1) : rawKey;
  const peerContext = key.indexOf("(");
  const base = peerContext === -1 ? key : key.slice(0, peerContext);
  const separator = base.lastIndexOf("@");
  if (separator <= 0) return null;

  const name = base.slice(0, separator);
  const version = base.slice(separator + 1);
  return name && valid(version) ? { name, version } : null;
}

export function inventoryFromLockfile(lockfile) {
  if (!lockfile || typeof lockfile !== "object" || !lockfile.packages) {
    throw new Error("pnpm-lock.yaml has no packages map");
  }

  const inventory = new Map();
  const unsupported = [];
  for (const key of Object.keys(lockfile.packages)) {
    const coordinate = parsePackageCoordinate(key);
    if (!coordinate) {
      unsupported.push(key);
      continue;
    }
    const versions = inventory.get(coordinate.name) ?? new Set();
    versions.add(coordinate.version);
    inventory.set(coordinate.name, versions);
  }

  if (unsupported.length) {
    throw new Error(
      `unsupported lockfile package coordinates: ${unsupported.slice(0, 5).join(", ")}`
    );
  }
  return inventory;
}

export function auditPayload(inventory) {
  return Object.fromEntries(
    [...inventory.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, versions]) => [name, [...versions].sort()])
  );
}

export function severityRank(severity) {
  return Object.hasOwn(SEVERITY, severity)
    ? SEVERITY[severity]
    : SEVERITY.critical;
}

export function matchAdvisories(inventory, response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("npm bulk advisory response is not an object");
  }

  const findings = [];
  for (const [name, advisories] of Object.entries(response)) {
    if (!Array.isArray(advisories)) {
      throw new Error(`npm advisories for ${name} are not an array`);
    }
    const versions = [...(inventory.get(name) ?? [])];
    for (const advisory of advisories) {
      if (!advisory || typeof advisory !== "object") {
        throw new Error(`npm returned an invalid advisory for ${name}`);
      }
      const range = advisory.vulnerable_versions;
      if (typeof range !== "string") {
        throw new Error(
          `npm advisory ${advisory.id ?? "unknown"} has no vulnerable range`
        );
      }

      let affected;
      try {
        affected = versions.filter(version =>
          satisfies(version, range, { includePrerelease: true })
        );
      } catch (error) {
        throw new Error(
          `npm advisory ${advisory.id ?? "unknown"} has an invalid range: ${error.message}`
        );
      }
      if (!affected.length) continue;

      const severity = String(advisory.severity ?? "unknown").toLowerCase();
      findings.push({
        id: String(advisory.id ?? "unknown"),
        name,
        versions: affected.sort(),
        severity,
        title: String(advisory.title ?? "Untitled advisory"),
        url: typeof advisory.url === "string" ? advisory.url : "",
      });
    }
  }
  return findings.sort((left, right) => {
    const severityDelta =
      severityRank(right.severity) - severityRank(left.severity);
    return (
      severityDelta ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function blocksAt(findings, threshold) {
  if (!Object.hasOwn(SEVERITY, threshold)) {
    throw new Error(`unsupported AUDIT_LEVEL: ${threshold}`);
  }
  return findings.filter(
    finding => severityRank(finding.severity) >= SEVERITY[threshold]
  );
}

async function fetchAdvisories(payload) {
  const response = await fetch(AUDIT_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "afrohit-security-audit/1.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `npm bulk advisory endpoint returned ${response.status}: ${body.slice(0, 300)}`
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("npm bulk advisory endpoint returned invalid JSON");
  }
}

export async function main() {
  const lockfileUrl = new URL("../pnpm-lock.yaml", import.meta.url);
  const lockfile = parse(await readFile(lockfileUrl, "utf8"));
  const inventory = inventoryFromLockfile(lockfile);
  const payload = auditPayload(inventory);
  const versionCount = Object.values(payload).reduce(
    (total, versions) => total + versions.length,
    0
  );
  console.log(
    `Auditing ${versionCount} exact locked versions across ${inventory.size} packages via npm bulk advisories...`
  );

  const findings = matchAdvisories(inventory, await fetchAdvisories(payload));
  for (const finding of findings) {
    const link = finding.url ? ` ${finding.url}` : "";
    console.log(
      `[${finding.severity}] ${finding.name}@${finding.versions.join(",")} ${finding.title}${link}`
    );
  }

  const threshold = String(process.env.AUDIT_LEVEL ?? "high").toLowerCase();
  const blocking = blocksAt(findings, threshold);
  if (blocking.length) {
    console.error(
      `Security audit blocked: ${blocking.length} finding(s) at or above ${threshold}.`
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Security audit passed: ${findings.length} advisory match(es), none at or above ${threshold}.`
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(`Security audit failed closed: ${error.message}`);
    process.exitCode = 2;
  });
}
