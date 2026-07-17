import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertSafeUrl,
  hostIsBlocked,
  ipIsPrivate,
} from "../../../packages/shared/src/server-url-safety";
import {
  parseStorageUri,
  storageUri,
} from "../../../packages/shared/src/storage-uri";
import { escapeHtml } from "../../../packages/shared/src/html";
import { redactSensitiveText } from "../../../packages/shared/src/redact";
import {
  createShareLinkSchema,
  voiceConsentInputSchema,
} from "../../../packages/shared/src/schemas";
import {
  VOICE_CONSENT_TEXT,
  VOICE_CONSENT_VERSION,
} from "../../../packages/shared/src/voice-consent";
import { validateCreditPackCapture } from "../../api/src/lib/billing-catalog";
import { sanitizeRequestUrl } from "../../api/src/lib/observability";
import {
  isSealedSecret,
  openSecret,
  sealSecret,
  secretHint,
} from "../../../packages/db/src/secrets";
import {
  adminGrantCookie,
  originAllowed,
  sessionCookie,
  signAdminGrant,
  signSession,
  validAdminGrant,
  verifySession,
} from "../../api/src/lib/session";

async function main() {
  assert.equal(ipIsPrivate("127.0.0.1"), true);
  assert.equal(ipIsPrivate("10.20.30.40"), true);
  assert.equal(ipIsPrivate("169.254.169.254"), true);
  assert.equal(ipIsPrivate("2130706433"), true);
  assert.equal(ipIsPrivate("::ffff:7f00:1"), true);
  assert.equal(ipIsPrivate("fc00::1"), true);
  assert.equal(ipIsPrivate("2606:4700:4700::1111"), false);
  assert.equal(ipIsPrivate("8.8.8.8"), false);
  assert.equal(hostIsBlocked("cdn.youtube.com"), true);
  assert.equal((await assertSafeUrl("http://2130706433/audio.wav")).ok, false);
  assert.equal(
    (await assertSafeUrl("https://youtube.com/watch?v=test")).ok,
    false
  );
  assert.equal((await assertSafeUrl("https://8.8.8.8/audio.wav")).ok, true);

  const ref = storageUri("afrohit-studio", "workspace-1/audio/file.wav");
  assert.deepEqual(parseStorageUri(ref), {
    bucket: "afrohit-studio",
    key: "workspace-1/audio/file.wav",
  });
  for (const invalid of [
    "s3://user@afrohit-studio/workspace/file.wav",
    "s3://afrohit-studio/workspace/%2e%2e/file.wav",
    "s3://afrohit-studio/workspace//file.wav",
    "s3://afrohit-studio/workspace/file.wav?token=leak",
  ])
    assert.equal(parseStorageUri(invalid), null);

  assert.equal(
    escapeHtml("<img src=x onerror=alert(1)>"),
    "&lt;img src=x onerror=alert(1)&gt;"
  );
  const redacted = redactSensitiveText(
    "Bearer topsecret https://cdn.example/file.wav?X-Amz-Signature=abc user@example.com"
  );
  assert.doesNotMatch(redacted, /topsecret|X-Amz-Signature|user@example/);
  assert.equal(
    sanitizeRequestUrl("/api/v1/analyze?token=secret&email=user@example.com"),
    "/api/v1/analyze"
  );
  assert.equal(
    createShareLinkSchema.safeParse({
      songId: "cm12345678901234567890123",
      targetUrl: "javascript:alert(1)",
    }).success,
    false
  );
  assert.equal(
    createShareLinkSchema.safeParse({
      songId: "cm12345678901234567890123",
      targetUrl: "https://music.example/song",
    }).success,
    true
  );
  const consent = {
    artistId: "cm12345678901234567890123",
    legalName: "Test Artist",
    email: "artist@example.com",
    consentText: VOICE_CONSENT_TEXT,
    consentVersion: VOICE_CONSENT_VERSION,
    accepted: true,
  };
  assert.equal(voiceConsentInputSchema.safeParse(consent).success, true);
  assert.equal(
    voiceConsentInputSchema.safeParse({
      ...consent,
      consentText: "I agree to something else entirely.",
    }).success,
    false
  );

  const capture = JSON.stringify({
    workspaceId: "workspace-1234567890",
    pack: "pack_25",
    creditsCents: 250_000,
  });
  assert.deepEqual(
    validateCreditPackCapture(capture, {
      value: "25.00",
      currency_code: "USD",
    }),
    {
      workspaceId: "workspace-1234567890",
      pack: "pack_25",
      creditsCents: 250_000,
    }
  );
  assert.equal(
    validateCreditPackCapture(capture, { value: "1.00", currency_code: "USD" }),
    null
  );
  assert.equal(
    validateCreditPackCapture(capture, {
      value: "25.00",
      currency_code: "EUR",
    }),
    null
  );

  const oldEncryptionKey = process.env.ENCRYPTION_KEY;
  const oldJwtSecret = process.env.JWT_SECRET;
  const oldAdminSecret = process.env.ADMIN_SECRET;
  const oldWebUrl = process.env.WEB_URL;
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const sealed = sealSecret("provider-secret-1234");
    assert.equal(isSealedSecret(sealed), true);
    assert.equal(openSecret(sealed), "provider-secret-1234");
    assert.equal(secretHint(sealed), "****1234");
    const envelope = sealed.split(".");
    const ciphertext = envelope[2]!;
    envelope[2] = `${ciphertext[0] === "a" ? "b" : "a"}${ciphertext.slice(1)}`;
    const tampered = envelope.join(".");
    assert.throws(() => openSecret(tampered));
    assert.equal(openSecret("legacy-plaintext"), "legacy-plaintext");

    process.env.JWT_SECRET = "j".repeat(48);
    process.env.ADMIN_SECRET = "a".repeat(48);
    process.env.WEB_URL = "https://studio.example.com";
    process.env.NODE_ENV = "production";
    const session = signSession({
      sub: "user-1",
      workspaceId: "workspace-1",
      role: "OWNER",
    });
    assert.equal(verifySession(session)?.sub, "user-1");
    assert.equal(verifySession(`${session.slice(0, -1)}x`), null);
    const cookie = sessionCookie(session);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.equal(originAllowed("https://studio.example.com"), true);
    assert.equal(originAllowed("https://evil.example.com"), false);

    const grant = signAdminGrant("user-1", "workspace-1");
    const grantPair = adminGrantCookie(grant).split(";")[0]!;
    const request = { headers: { cookie: grantPair } } as never;
    assert.equal(validAdminGrant(request, "user-1", "workspace-1"), true);
    assert.equal(validAdminGrant(request, "user-2", "workspace-1"), false);
    assert.equal(validAdminGrant(request, "user-1", "workspace-2"), false);
  } finally {
    if (oldEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = oldEncryptionKey;
    if (oldJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldJwtSecret;
    if (oldAdminSecret === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = oldAdminSecret;
    if (oldWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = oldWebUrl;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  }

  const authSource = readFileSync(
    join(process.cwd(), "..", "api", "src", "middleware", "auth.ts"),
    "utf8"
  );
  assert.equal(authSource.includes("prisma.user.upsert({"), true);
  assert.equal(authSource.includes("prisma.workspace.upsert({"), true);
  assert.equal(authSource.includes("identityPromise"), true);
  const apiIndexSource = readFileSync(
    join(process.cwd(), "..", "api", "src", "index.ts"),
    "utf8"
  );
  assert.match(apiIndexSource, /redis:\s*app\.rateLimitRedis/);
  // RESILIENCE (audit 2026-07-17): the limiter now FAILS OPEN — skipOnError
  // true — so a Redis blip degrades to briefly-unmetered instead of taking
  // the whole API down. The per-workspace throttles bound the expensive
  // routes when Redis is gone. (Was `false`; that made the abuse limiter a
  // single point of failure for every route.)
  assert.match(apiIndexSource, /skipOnError: true/);
  assert.doesNotMatch(
    apiIndexSource,
    /new Map<string, \{ n: number; reset: number \}>/
  );
  assert.ok(
    apiIndexSource.indexOf("await app.register(queuePlugin)") <
      apiIndexSource.indexOf("await app.register(rateLimit")
  );
  const projectsSource = readFileSync(
    join(process.cwd(), "..", "api", "src", "routes", "projects.ts"),
    "utf8"
  );
  const songsSource = readFileSync(
    join(process.cwd(), "..", "api", "src", "routes", "songs.ts"),
    "utf8"
  );
  assert.match(
    projectsSource,
    /app\.delete<[\s\S]*?requireRole\(req, \[['"]OWNER['"], ['"]ADMIN['"]\]\)/
  );
  assert.match(
    songsSource,
    /app\.delete<[\s\S]*?requireRole\(req, \[['"]OWNER['"], ['"]ADMIN['"]\]\)/
  );
  const analyzeWorkerSource = readFileSync(
    join(process.cwd(), "src", "processors", "analyze.ts"),
    "utf8"
  );
  assert.match(analyzeWorkerSource, /downloadToBuffer\(p\.url, \{/);
  assert.doesNotMatch(analyzeWorkerSource, /measureAudioQuality\(p\.url\)/);
  assert.doesNotMatch(analyzeWorkerSource, /measureAudio\(p\.url\)/);
  const compoundSource = readFileSync(
    join(process.cwd(), "src", "processors", "compound.ts"),
    "utf8"
  );
  assert.match(compoundSource, /usage could not be verified/);
  assert.match(compoundSource, /return false;/);
  const cronSource = readFileSync(
    join(process.cwd(), "src", "processors", "cron.ts"),
    "utf8"
  );
  assert.match(cronSource, /refundDebitedCredits/);
  assert.match(cronSource, /charge reversed/);
  const workerDockerfile = readFileSync(
    join(process.cwd(), "Dockerfile"),
    "utf8"
  );
  assert.match(workerDockerfile, /^USER node$/m);
  console.log("security boundaries: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
