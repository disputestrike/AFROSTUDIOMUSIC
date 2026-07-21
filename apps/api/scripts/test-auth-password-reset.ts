/**
 * PASSWORD LIFECYCLE — change + forgotten-password reset (2026-07-20).
 *
 * Boots the REAL auth route module on a bare Fastify with an in-memory prisma
 * (injected through the @afrohit/db global singleton seam) and a simulated
 * signed-in identity, then proves the security contract end to end WITHOUT a
 * database:
 *   - change-password verifies the CURRENT password and enforces the min-12 rule
 *   - request-reset is ANTI-ENUMERATION (identical response, known vs unknown),
 *     stores only a token HASH, and creates a real expiring token
 *   - reset-password consumes a single-use token exactly once and rejects
 *     expired/used/unknown tokens
 *
 * Run: pnpm --filter @afrohit/api test:auth-password-reset
 */
import assert from "node:assert/strict";
import { randomBytes, scrypt } from "node:crypto";

process.env.NODE_ENV = "test"; // keep the @afrohit/db global-singleton seam active
process.env.AUTH_MODE = "internal";
delete process.env.RESEND_API_KEY; // email provider absent — must not change any response
process.env.WEB_URL = "https://studio.example";

// ---- In-memory prisma (only the calls the auth routes make) ---------------
type UserRow = { id: string; email: string; fullName: string | null; passwordHash: string | null };
type TokenRow = { id: string; userId: string; tokenHash: string; usedAt: Date | null; expiresAt: Date; createdAt: Date };

const users = new Map<string, UserRow>();
const tokens = new Map<string, TokenRow>();
let tokenSeq = 0;

function matchWhere<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "not" in (v as object)) return row[k] !== (v as { not: unknown }).not;
    return row[k] === v;
  });
}

const fakePrisma = {
  user: {
    async findUnique({ where }: { where: { id?: string; email?: string } }) {
      const row = [...users.values()].find(
        (u) => (where.id !== undefined && u.id === where.id) || (where.email !== undefined && u.email === where.email),
      );
      return row ? { ...row } : null;
    },
    async update({ where, data }: { where: { id: string }; data: Partial<UserRow> }) {
      const row = users.get(where.id);
      if (!row) throw new Error("user not found");
      Object.assign(row, data);
      return { ...row };
    },
  },
  passwordResetToken: {
    async findUnique({ where }: { where: { tokenHash: string } }) {
      const row = [...tokens.values()].find((t) => t.tokenHash === where.tokenHash);
      return row ? { ...row } : null;
    },
    async create({ data }: { data: Omit<TokenRow, "id" | "createdAt"> }) {
      const id = `tok_${++tokenSeq}`;
      const row: TokenRow = { id, createdAt: new Date(), usedAt: data.usedAt ?? null, ...data };
      tokens.set(id, row);
      return { ...row };
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<TokenRow> }) {
      let count = 0;
      for (const row of tokens.values()) {
        if (matchWhere(row as unknown as Record<string, unknown>, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    },
  },
  async $transaction(fn: (tx: typeof fakePrisma) => Promise<unknown>) {
    return fn(fakePrisma);
  },
};

// Inject BEFORE any module pulls in @afrohit/db.
(globalThis as unknown as { __afrohit_prisma: unknown }).__afrohit_prisma = fakePrisma;

async function scryptHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key: Buffer = await new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }, (e, k) =>
      e ? reject(e) : resolve(k),
    ),
  );
  return `scrypt:v2:${salt}:${key.toString("hex")}`;
}

async function main() {
  const { default: Fastify } = await import("fastify");
  const { validatorCompiler, serializerCompiler } = await import("fastify-type-provider-zod");
  const { default: authRoutes, hashResetToken } = await import("../src/routes/auth");

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("preValidation", async (req) => {
    (req as unknown as { auth: object }).auth = {
      userId: "user-1",
      workspaceId: "ws-1",
      role: "OWNER",
      isService: false,
    };
  });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.ready();

  const OLD = "old-password-123456";
  const NEW = "new-password-abcdefg";
  const THIRD = "third-password-778899";
  users.set("user-1", { id: "user-1", email: "owner@example.com", fullName: null, passwordHash: await scryptHash(OLD) });

  const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload });

  // ---- CHANGE PASSWORD -----------------------------------------------------
  // Wrong current password → 401, hash unchanged.
  let res = await post("/api/v1/auth/change-password", { currentPassword: "not-the-password", newPassword: NEW });
  assert.equal(res.statusCode, 401, `wrong current must be 401, got ${res.statusCode}: ${res.body}`);

  // New password too short → 400 (schema min 12).
  res = await post("/api/v1/auth/change-password", { currentPassword: OLD, newPassword: "short" });
  assert.equal(res.statusCode, 400, `short new password must be 400, got ${res.statusCode}`);

  // Correct current + valid new → 200.
  res = await post("/api/v1/auth/change-password", { currentPassword: OLD, newPassword: NEW });
  assert.equal(res.statusCode, 200, `valid change must be 200, got ${res.statusCode}: ${res.body}`);

  // Proof the new hash actually took: the NEW password is now the valid current.
  res = await post("/api/v1/auth/change-password", { currentPassword: NEW, newPassword: THIRD });
  assert.equal(res.statusCode, 200, "the new password must verify as current after a change");

  // The OLD password no longer works.
  res = await post("/api/v1/auth/change-password", { currentPassword: OLD, newPassword: "irrelevant-1234" });
  assert.equal(res.statusCode, 401, "the old password must stop working after a change");

  // ---- REQUEST RESET (anti-enumeration) ------------------------------------
  tokens.clear();
  const unknownRes = await post("/api/v1/auth/request-reset", { email: "nobody@example.com" });
  assert.equal(unknownRes.statusCode, 200, "unknown email must still be 200");
  assert.equal(tokens.size, 0, "unknown email must create NO token");

  const knownRes = await post("/api/v1/auth/request-reset", { email: "owner@example.com" });
  assert.equal(knownRes.statusCode, 200, "known email must be 200");
  assert.equal(knownRes.body, unknownRes.body, "known and unknown email must return an IDENTICAL body (anti-enumeration)");
  assert.equal(tokens.size, 1, "known email must create exactly one token");
  const created = [...tokens.values()][0]!;
  assert.match(created.tokenHash, /^[0-9a-f]{64}$/, "token is stored as a sha256 HASH, never plaintext");
  assert.ok(created.expiresAt.getTime() > Date.now(), "token must expire in the FUTURE");
  assert.ok(created.expiresAt.getTime() - Date.now() <= 60 * 60 * 1000 + 5000, "token expiry is ~1h, not longer");
  assert.equal(created.usedAt, null, "a freshly issued token is unused");

  // ---- RESET PASSWORD (single-use + expiry) --------------------------------
  // Seed a known token so we hold the RAW value (the route only ever stores the hash).
  const rawToken = randomBytes(32).toString("base64url");
  tokens.clear();
  tokens.set("seed", {
    id: "seed",
    userId: "user-1",
    tokenHash: hashResetToken(rawToken),
    usedAt: null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    createdAt: new Date(),
  });

  // Unknown token → 400.
  res = await post("/api/v1/auth/reset-password", { token: "not-a-real-token", newPassword: "brand-new-000000" });
  assert.equal(res.statusCode, 400, "unknown token must be 400");

  // Valid token → 200 and the new password now signs in.
  const RESET_PW = "reset-password-556677";
  res = await post("/api/v1/auth/reset-password", { token: rawToken, newPassword: RESET_PW });
  assert.equal(res.statusCode, 200, `valid reset must be 200, got ${res.statusCode}: ${res.body}`);
  assert.equal(tokens.get("seed")!.usedAt !== null, true, "a redeemed token must be marked used");
  res = await post("/api/v1/auth/change-password", { currentPassword: RESET_PW, newPassword: "after-reset-99887766" });
  assert.equal(res.statusCode, 200, "the reset password must verify as the account's current password");

  // Second use of the SAME token → 400 (single use).
  res = await post("/api/v1/auth/reset-password", { token: rawToken, newPassword: "second-use-12345678" });
  assert.equal(res.statusCode, 400, "a consumed token must be rejected on reuse (single-use)");

  // Expired token → 400.
  const expiredRaw = randomBytes(32).toString("base64url");
  tokens.set("expired", {
    id: "expired",
    userId: "user-1",
    tokenHash: hashResetToken(expiredRaw),
    usedAt: null,
    expiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(),
  });
  res = await post("/api/v1/auth/reset-password", { token: expiredRaw, newPassword: "expired-attempt-1234" });
  assert.equal(res.statusCode, 400, "an expired token must be rejected");

  await app.close();
  console.log("auth password lifecycle: change verifies current + min-length; reset is anti-enumeration, hashed, single-use, expiring — all pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
