import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type Redis from "ioredis";
import {
  isSessionRevoked,
  revokeSessionFamily,
  revokeSessionToken,
  SessionRevocationUnavailableError,
  sessionFamilyFromClaims,
  signSession,
  verifySession,
} from "../src/lib/session";

type StoredValue = { value: string; expiresAt: number };
type SetCommand = { key: string; value: string; ttlSeconds: number };

class MemoryTransaction {
  private readonly commands: SetCommand[] = [];

  constructor(private readonly redis: MemoryRedis) {}

  set(key: string, value: string, mode: string, ttlSeconds: number): this {
    assert.equal(mode, "EX");
    this.commands.push({ key, value, ttlSeconds });
    return this;
  }

  async exec(): Promise<Array<[Error | null, string | null]>> {
    if (this.redis.transactionError)
      return [[this.redis.transactionError, null]];
    for (const command of this.commands) this.redis.applySet(command);
    return this.commands.map(() => [null, "OK"]);
  }
}

class MemoryRedis {
  status = "ready";
  readonly values = new Map<string, StoredValue>();
  readError: Error | null = null;
  transactionError: Error | null = null;

  async mget(...keys: string[]): Promise<Array<string | null>> {
    if (this.readError) throw this.readError;
    return keys.map(key => {
      const stored = this.values.get(key);
      if (!stored) return null;
      if (stored.expiresAt <= Date.now()) {
        this.values.delete(key);
        return null;
      }
      return stored.value;
    });
  }

  multi(): MemoryTransaction {
    return new MemoryTransaction(this);
  }

  applySet(command: SetCommand): void {
    this.values.set(command.key, {
      value: command.value,
      expiresAt: Date.now() + command.ttlSeconds * 1_000,
    });
  }
}

function asRedis(redis: MemoryRedis): Redis {
  return redis as unknown as Redis;
}

function withoutFamilyClaims(token: string, secret: string): string {
  const [header, encodedPayload] = token.split(".") as [string, string, string];
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8")
  ) as Record<string, unknown>;
  delete payload.sid;
  delete payload.fexp;
  const legacyPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = createHmac("sha256", secret)
    .update(`${header}.${legacyPayload}`)
    .digest("base64url");
  return `${header}.${legacyPayload}.${signature}`;
}

const originalNow = Date.now;
const originalSecret = process.env.JWT_SECRET;
const originalTimeout = process.env.SESSION_REVOCATION_TIMEOUT_MS;
let now = Date.parse("2026-07-15T18:00:00.000Z");

async function main(): Promise<void> {
  try {
    Date.now = () => now;
    process.env.JWT_SECRET = "session-revocation-test-secret-".repeat(2);
    process.env.SESSION_REVOCATION_TIMEOUT_MS = "100";

    const identity = {
      sub: "user-1",
      workspaceId: "workspace-1",
      role: "OWNER",
    };
    const firstToken = signSession(identity, 60 * 60);
    const first = verifySession(firstToken);
    assert.ok(first);

    const rotatedToken = signSession(
      identity,
      60 * 60,
      sessionFamilyFromClaims(first)
    );
    const rotated = verifySession(rotatedToken);
    assert.ok(rotated);
    assert.equal(
      rotated.sid,
      first.sid,
      "rotation must preserve the session family"
    );
    assert.equal(
      rotated.fexp,
      first.fexp,
      "rotation must preserve the family expiry"
    );
    assert.notEqual(
      rotated.jti,
      first.jti,
      "each access token must have a unique JTI"
    );

    const independent = verifySession(signSession(identity, 60 * 60));
    assert.ok(independent);
    assert.notEqual(
      independent.sid,
      first.sid,
      "a separate login must receive a separate family"
    );

    const legacy = verifySession(
      withoutFamilyClaims(firstToken, process.env.JWT_SECRET)
    );
    assert.ok(legacy);
    assert.equal(
      legacy.sid,
      legacy.jti,
      "legacy JWTs use their JTI as a one-token family"
    );
    assert.equal(legacy.fexp, legacy.exp);

    const redis = new MemoryRedis();
    assert.equal(await isSessionRevoked(asRedis(redis), first), false);
    assert.equal(await isSessionRevoked(asRedis(redis), rotated), false);

    await revokeSessionToken(asRedis(redis), first);
    assert.equal(await isSessionRevoked(asRedis(redis), first), true);
    assert.equal(
      await isSessionRevoked(asRedis(redis), rotated),
      false,
      "JTI revocation must not break rotation"
    );
    assert.equal(await isSessionRevoked(asRedis(redis), independent), false);

    const tokenEntry = [...redis.values.entries()][0];
    assert.ok(tokenEntry);
    assert.match(tokenEntry[0], /^auth:session-revoked:v1:jti:/);
    assert.equal(
      tokenEntry[0].includes(first.jti),
      false,
      "Redis keys must not expose token identifiers"
    );
    assert.equal(tokenEntry[1].expiresAt, first.exp * 1_000);

    await revokeSessionFamily(asRedis(redis), rotated);
    assert.equal(await isSessionRevoked(asRedis(redis), first), true);
    assert.equal(await isSessionRevoked(asRedis(redis), rotated), true);
    assert.equal(
      await isSessionRevoked(asRedis(redis), independent),
      false,
      "families must remain isolated"
    );

    const familyEntry = [...redis.values.entries()].find(([key]) =>
      key.includes(":sid:")
    );
    assert.ok(familyEntry);
    assert.equal(
      familyEntry[0].includes(first.sid),
      false,
      "Redis keys must not expose family identifiers"
    );
    assert.equal(familyEntry[1].expiresAt, first.fexp * 1_000);

    now += 2 * 60 * 60 * 1_000;
    assert.equal(
      await isSessionRevoked(asRedis(redis), rotated),
      true,
      "family tombstone must outlive access JWTs"
    );

    const disconnected = new MemoryRedis();
    disconnected.status = "reconnecting";
    await assert.rejects(
      isSessionRevoked(asRedis(disconnected), independent),
      SessionRevocationUnavailableError
    );

    const readFailure = new MemoryRedis();
    readFailure.readError = new Error("read failed");
    await assert.rejects(
      isSessionRevoked(asRedis(readFailure), independent),
      SessionRevocationUnavailableError
    );

    const writeFailure = new MemoryRedis();
    writeFailure.transactionError = new Error("transaction failed");
    await assert.rejects(
      revokeSessionFamily(asRedis(writeFailure), independent),
      SessionRevocationUnavailableError
    );

    console.log("session revocation tests passed");
  } finally {
    Date.now = originalNow;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    if (originalTimeout === undefined)
      delete process.env.SESSION_REVOCATION_TIMEOUT_MS;
    else process.env.SESSION_REVOCATION_TIMEOUT_MS = originalTimeout;
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
