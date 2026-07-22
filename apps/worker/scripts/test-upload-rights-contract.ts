/**
 * PERMANENT GUARD — the "bring your own audio" rights contract (2026-07-22).
 *
 * A whole class of break-flow bugs hid here: an upload/import/analyze button
 * looks fine, compiles fine, and hard-400s the moment a user actually clicks it,
 * because the frontend body omitted the `rightsConfirmation` (or `factsOnly`)
 * field that the route's `.strict()` Zod schema REQUIRES. Unit tests never catch
 * it — only a real click does. So this test statically walks every `api.post`
 * in the web app and fails if a rights-gated endpoint is called without the
 * field. It is the mechanical version of "click every upload button".
 *
 *   /beats/upload  /mixes/upload  /uploads/import  -> require rightsConfirmation
 *   /analyze                                        -> require factsOnly OR rightsConfirmation
 *
 * If you add a new caller, send the field. If you add a new rights-gated
 * endpoint, add it to RIGHTS_ENDPOINTS below.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB = join(ROOT, "apps", "web");

/** Every .ts/.tsx under apps/web, minus build output. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** The balanced source of ONE api.post(...) call starting at `postIdx`. Paren
 *  counting is enough: the only parens inside these calls are balanced helper
 *  calls (Number(), clampAttachBpm()); the URLs and bodies carry none. */
function callSpan(text: string, postIdx: number): string {
  const open = text.indexOf("(", postIdx);
  if (open < 0) return text.slice(postIdx, postIdx + 600);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(postIdx, i + 1);
    }
  }
  return text.slice(postIdx, postIdx + 600);
}

const failures: string[] = [];
let postCalls = 0;
let checked = 0;

for (const file of walk(WEB)) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
  let from = 0;
  for (;;) {
    const idx = text.indexOf("api.post", from);
    if (idx < 0) break;
    from = idx + 8;
    postCalls++;
    const span = callSpan(text, idx);
    const line = text.slice(0, idx).split("\n").length;

    // Rights-gated uploads/import: rightsConfirmation is mandatory.
    if (/\/(beats|mixes)\/upload[`'"]/.test(span) || /\/uploads\/import[`'"]/.test(span)) {
      checked++;
      if (!/rightsConfirmation/.test(span)) {
        failures.push(`${rel}:${line} — upload/import call MISSING rightsConfirmation`);
      }
    }
    // analyze: either the facts-only branch (factsOnly:true) or the full-rights
    // branch (rightsConfirmation). One of them MUST be present.
    else if (/\/analyze[`'"]/.test(span)) {
      checked++;
      if (!/factsOnly/.test(span) && !/rightsConfirmation/.test(span)) {
        failures.push(`${rel}:${line} — /analyze call MISSING factsOnly and rightsConfirmation`);
      }
    }
  }
}

console.log(
  `upload-rights contract: scanned ${postCalls} api.post calls across apps/web, checked ${checked} rights-gated callers`
);

if (checked === 0) {
  console.error(
    "❌ found ZERO rights-gated callers — the scanner is broken (endpoints renamed?), not a clean pass"
  );
  process.exit(1);
}

if (failures.length) {
  console.error(`\n❌ ${failures.length} rights-gated caller(s) will hard-400 on a real click:`);
  for (const f of failures) console.error("   - " + f);
  console.error(
    "\nFix: send `rightsConfirmation: { version: 1, confirmed: true }` (uploads/import),\n" +
      "or `factsOnly: true` (facts-only /analyze). See the schemas in packages/shared/src/schemas.ts."
  );
  process.exit(1);
}

console.log(`✅ all ${checked} rights-gated web callers send the required field`);
