import assert from "node:assert/strict";
import test from "node:test";
import {
  auditPayload,
  blocksAt,
  inventoryFromLockfile,
  matchAdvisories,
  parsePackageCoordinate,
  severityRank,
} from "./security-audit.mjs";

test("parses scoped and peer-qualified pnpm package coordinates", () => {
  assert.deepEqual(parsePackageCoordinate("undici@6.27.0"), {
    name: "undici",
    version: "6.27.0",
  });
  assert.deepEqual(
    parsePackageCoordinate("@fastify/cors@10.1.0(fastify@5.6.2)"),
    {
      name: "@fastify/cors",
      version: "10.1.0",
    }
  );
  assert.equal(parsePackageCoordinate("workspace:packages/shared"), null);
});

test("builds a deterministic exact-version payload from the lockfile", () => {
  const inventory = inventoryFromLockfile({
    packages: {
      "zod@3.25.76": {},
      "undici@6.27.0": {},
      "zod@3.24.0(peer@1.0.0)": {},
    },
  });
  assert.deepEqual(auditPayload(inventory), {
    undici: ["6.27.0"],
    zod: ["3.24.0", "3.25.76"],
  });
});

test("matches exact vulnerable versions and enforces the threshold", () => {
  const inventory = new Map([
    ["example", new Set(["1.0.0", "2.0.0"])],
    ["safe", new Set(["5.0.0"])],
  ]);
  const findings = matchAdvisories(inventory, {
    example: [
      {
        id: 101,
        title: "Serious issue",
        severity: "high",
        vulnerable_versions: ">=1 <2",
        url: "https://github.com/advisories/GHSA-test-test-test",
      },
    ],
    safe: [
      {
        id: 102,
        title: "Old issue",
        severity: "critical",
        vulnerable_versions: "<5",
      },
    ],
  });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].versions, ["1.0.0"]);
  assert.equal(blocksAt(findings, "high").length, 1);
  assert.equal(blocksAt(findings, "critical").length, 0);
});

test("unknown severities fail closed at the highest rank", () => {
  assert.equal(severityRank("future-severity"), severityRank("critical"));
});

test("rejects package coordinates the registry cannot audit", () => {
  assert.throws(
    () =>
      inventoryFromLockfile({
        packages: { "git+https://example.invalid/repo": {} },
      }),
    /unsupported lockfile package coordinates/
  );
});
