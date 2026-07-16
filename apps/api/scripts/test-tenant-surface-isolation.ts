/**
 * TENANT SURFACE ISOLATION (Wave 8a) — server-enforcement proof.
 *
 * Boots the REAL route modules on a bare Fastify instance with a simulated
 * authenticated NON-operator tenant (req.auth set, no admin identity) and
 * asserts every operator-only route rejects with requireAdmin's own error
 * BEFORE any handler/database work runs. AUTH_MODE=internal keeps requireAdmin
 * database-free (admin grant cookie check), so this proves the wall itself —
 * no Postgres, no Redis, no keys.
 *
 * Run: pnpm --filter @afrohit/api test:tenant-surface-isolation
 */
import assert from "node:assert/strict";

process.env.AUTH_MODE = "internal"; // requireAdmin → validAdminGrant (no DB); no grant cookie = locked
delete process.env.ADMIN_EMAILS;

async function main() {
  const { default: Fastify } = await import("fastify");
  const { validatorCompiler, serializerCompiler } = await import(
    "fastify-type-provider-zod"
  );
  const [
    { default: materials },
    { default: instrumentals },
    { default: lexicon },
    { default: benchmark },
    { default: zap },
    { default: taste },
    { default: lanes },
    { default: debug },
    { default: admin },
  ] = await Promise.all([
    import("../src/routes/materials"),
    import("../src/routes/instrumentals"),
    import("../src/routes/lexicon"),
    import("../src/routes/benchmark"),
    import("../src/routes/zap"),
    import("../src/routes/taste"),
    import("../src/routes/lanes"),
    import("../src/routes/debug"),
    import("../src/routes/admin"),
  ]);

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Simulate the auth plugin having resolved a plain tenant (OWNER of their own
  // workspace — the strongest non-operator identity a signup can hold).
  app.addHook("preValidation", async req => {
    (req as unknown as { auth: object }).auth = {
      userId: "tenant-user",
      workspaceId: "tenant-workspace",
      role: "OWNER",
      isService: false,
    };
  });
  await app.register(materials, { prefix: "/api/v1/materials" });
  await app.register(instrumentals, { prefix: "/api/v1/instrumentals" });
  await app.register(lexicon, { prefix: "/api/v1/lexicon" });
  await app.register(benchmark, { prefix: "/api/v1/benchmark" });
  await app.register(zap, { prefix: "/api/v1/zap" });
  await app.register(taste, { prefix: "/api/v1/taste" });
  await app.register(lanes, { prefix: "/api/v1/lanes" });
  await app.register(debug, { prefix: "/api/v1/debug" });
  await app.register(admin, { prefix: "/api/v1/admin" });
  await app.ready();

  const gated: Array<[string, string]> = [
    // materials — whole plugin
    ["GET", "/api/v1/materials"],
    ["GET", "/api/v1/materials/some-id/usage"],
    ["POST", "/api/v1/materials/forge"],
    ["POST", "/api/v1/materials/synth"],
    ["POST", "/api/v1/materials/own-engine"],
    ["POST", "/api/v1/materials/auto"],
    ["POST", "/api/v1/materials/assemble"],
    // instrumentals — whole plugin
    ["GET", "/api/v1/instrumentals"],
    ["POST", "/api/v1/instrumentals/some-id/reuse"],
    // lexicon — whole plugin
    ["GET", "/api/v1/lexicon"],
    ["GET", "/api/v1/lexicon/stats"],
    ["POST", "/api/v1/lexicon"],
    ["DELETE", "/api/v1/lexicon/some-id"],
    // benchmark — whole plugin
    ["POST", "/api/v1/benchmark/rate"],
    ["GET", "/api/v1/benchmark/queue"],
    ["GET", "/api/v1/benchmark/summary"],
    ["GET", "/api/v1/benchmark/pair"],
    ["POST", "/api/v1/benchmark/pick"],
    ["GET", "/api/v1/benchmark/ab-summary"],
    ["GET", "/api/v1/benchmark/competitor/candidates"],
    ["POST", "/api/v1/benchmark/competitor/pairs"],
    ["GET", "/api/v1/benchmark/competitor/pairs"],
    ["GET", "/api/v1/benchmark/competitor/pairs/p1/audio/a"],
    ["POST", "/api/v1/benchmark/competitor/pairs/p1/judge"],
    ["GET", "/api/v1/benchmark/competitor/evidence"],
    // zap — whole plugin (spends research money)
    ["POST", "/api/v1/zap/identify"],
    ["POST", "/api/v1/zap/learn"],
    ["GET", "/api/v1/zap/history"],
    ["POST", "/api/v1/zap/lane-brief"],
    ["POST", "/api/v1/zap/radar"],
    // taste — the LAKE routes only (sound-profile/score stay tenant surfaces)
    ["GET", "/api/v1/taste/data-lake"],
    ["GET", "/api/v1/taste/utilization"],
    ["PATCH", "/api/v1/taste/references/r1/classification"],
    ["DELETE", "/api/v1/taste/references/r1"],
    // pre-existing guards that must stay
    ["GET", "/api/v1/lanes/inventory"],
    ["GET", "/api/v1/debug/ai"],
    ["GET", "/api/v1/debug/lyric-raw"],
    ["GET", "/api/v1/debug/generation-context"],
    ["GET", "/api/v1/admin/stats"],
    ["POST", "/api/v1/admin/run"],
  ];

  // admin/run guards INSIDE the handler (after schema validation), so it needs
  // a schema-valid body to prove the wall; the plugin-scoped guards reject the
  // deliberately-empty body BEFORE validation ever sees a tenant payload.
  const validBodies: Record<string, unknown> = {
    "/api/v1/admin/run": { task: "nightly-compound" },
  };

  for (const [method, url] of gated) {
    const res = await app.inject({
      method: method as "GET",
      url,
      ...(method === "GET" || method === "DELETE"
        ? {}
        : { payload: validBodies[url] ?? {} }),
    });
    assert.ok(
      res.statusCode === 401 || res.statusCode === 403,
      `${method} ${url} must be operator-locked, got ${res.statusCode}: ${res.body.slice(0, 200)}`
    );
    assert.match(
      res.body,
      /admin locked|forbidden/i,
      `${method} ${url} must be rejected by requireAdmin, got: ${res.body.slice(0, 200)}`
    );
  }

  // Tenant-reachable surfaces must NOT be behind the operator wall. Without a
  // database they fail later in the handler (5xx) — the assertion is only that
  // requireAdmin did not block them.
  const open: Array<[string, string]> = [
    ["GET", "/api/v1/taste/sound-profile"],
    ["GET", "/api/v1/lanes/afrobeats/profile"],
    ["GET", "/api/v1/lanes/gap-map"],
  ];
  for (const [method, url] of open) {
    const res = await app.inject({ method: method as "GET", url });
    assert.ok(
      res.statusCode !== 401 && res.statusCode !== 403,
      `${method} ${url} is a tenant surface and must not be operator-locked, got ${res.statusCode}`
    );
  }

  await app.close();
  console.log(
    `tenant surface isolation: ${gated.length} operator routes locked, ${open.length} tenant surfaces open`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
