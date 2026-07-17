/**
 * PRE-RELEASE SECURITY GATE (2026-07-17). Proves every hardening from the
 * adversarial audit is in place — so a future edit that removes a defense is
 * a FAILING test, not a silent regression. Pure/static where a live server
 * isn't needed; wiring pins where it is.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isAllowedShareTarget,
  checkGenerativeContent,
} from "@afrohit/shared";

// ---- Open-redirect defense (pure law).
assert.equal(isAllowedShareTarget("https://open.spotify.com/track/x"), true, "real platform allowed");
assert.equal(isAllowedShareTarget("https://music.apple.com/x"), true);
assert.equal(isAllowedShareTarget("https://evil-phishing.example/login"), false, "arbitrary host refused");
assert.equal(isAllowedShareTarget("http://phish.io"), false);
assert.equal(isAllowedShareTarget("javascript:alert(1)"), false, "non-http refused");
assert.equal(isAllowedShareTarget("https://user:pw@spotify.com"), false, "embedded creds refused");
assert.equal(
  isAllowedShareTarget("https://tenant.audiomack.com/song", { SHARE_REDIRECT_ALLOWED_HOSTS: "" } as never),
  true,
  "subdomain of an allowed host is allowed"
);

// ---- Content-abuse gate (pure law).
assert.equal(checkGenerativeContent("a dark-skinned Nigerian woman dancing in Lagos").ok, true, "legit treatment passes");
assert.equal(checkGenerativeContent("").ok, true, "empty passes");
assert.equal(checkGenerativeContent("Spider-Man swinging over Lagos").ok, false, "copyrighted character refused");
assert.equal(checkGenerativeContent("the pope blessing the crowd").ok, false, "real public figure refused");

// ---- Wiring pins.
const chat = readFileSync(join(process.cwd(), "src/routes/chat.ts"), "utf8");
assert.match(chat, /async function ownedProjectId/, "chat has the tenant-ownership helper");
assert.equal(
  (chat.match(/projectId: await ownedProjectId\(workspaceId, body\.projectId\)/g) ?? []).length,
  2,
  "BOTH chat thread-create sites validate project ownership (IDOR fix)"
);
assert.equal(
  (chat.match(/await workspaceThrottle\(app, \{/g) ?? []).length,
  2,
  "BOTH chat endpoints carry the per-workspace throttle"
);
assert.match(chat, /action: body\.autopilot \? 'chat-autopilot' : 'chat'/, "autopilot throttled separately");

const index = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
assert.match(index, /skipOnError: true/, "the rate limiter fails OPEN — a Redis blip must not take the API down");
assert.doesNotMatch(index, /contentSecurityPolicy: false,\s*\}\);/, "CSP is no longer globally disabled");

const shares = readFileSync(join(process.cwd(), "src/routes/shares.ts"), "utf8");
const redirectAt = shares.indexOf("/redirect/:code");
const guardAt = shares.indexOf("isAllowedShareTarget(parsed.data)", redirectAt);
const doRedirectAt = shares.indexOf("reply.redirect(parsed.data", guardAt);
assert.ok(redirectAt >= 0 && guardAt > redirectAt && doRedirectAt > guardAt, "the redirect is guarded BEFORE it fires");

const credits = readFileSync(join(process.cwd(), "src/middleware/credits.ts"), "utf8");
assert.match(credits, /dailyCostCeiling: betaDailyCostCeiling\(\)/, "beta path carries a hard money ceiling");
assert.doesNotMatch(
  credits.slice(credits.indexOf("if (firstParty)")),
  /dailyCostCeiling/,
  "the house (first-party) path is NOT ceilinged"
);

const charge = readFileSync(join(process.cwd(), "../../packages/db/src/credit-charge.ts"), "utf8");
assert.match(charge, /reason: "daily_spend_ceiling"/, "the cost ceiling is enforced in the charge law");
assert.match(charge, /_sum: \{ delta: true \}/, "the ceiling sums real cost (delta), not operation count");

const auth = readFileSync(join(process.cwd(), "src/routes/auth.ts"), "utf8");
assert.match(auth, /captchaRequired\(\) && !\(await verifyCaptcha\(input\.captchaToken\)\)/, "signup carries the captcha gate");

const videos = readFileSync(join(process.cwd(), "src/routes/videos.ts"), "utf8");
assert.match(videos, /checkGenerativeContent\(input\.prompt\)/, "video prompt runs the content gate before spend");

console.log("security hardening: IDOR, throttle, redirect, cost-ceiling, captcha, content-gate, CSP, and Redis-resilience all pinned");
