/**
 * AFROONE RELIABLE SINGING — forge ONCE per lane + reuse (kill the ~$0.80/song
 * re-forge) and GUARANTEE the singing step (a withVocals song never ends silent).
 *
 * EVIDENCE this fixes (owner's live Replicate bill + a working song cmrveu1cc):
 * a GOOD AfroOne song sang (auto-route + withVocals + AFROONE_SINGING_ENABLED →
 * forge kit → compose melody → afroone-singing → word-verify → master → stems),
 * but the dashboard showed 8× meta/musicgen per song and a song "true" DIED
 * before it sang. Two properties, enforced forever:
 *
 *  FIX 1 — FORGE ONCE PER LANE, THEN REUSE. richMissing forges ONLY the roles
 *  the shelf lacks; a SUCCESSFUL forge persists (source 'forged', readiness
 *  'ready', qualityState 'passed') and pickKit re-selects it next render, so a
 *  role is never re-forged (a). Partial shelf → only the gap is forged (d). The
 *  remaining leak — a role whose forge keeps FAILING QC (rejected row, invisible
 *  to pickKit) getting re-forged EVERY render — is closed by a rejected-forge
 *  cooldown.
 *
 *  FIX 2 — GUARANTEE THE SINGING STEP. The singing branch runs over whatever bed
 *  exists (forged OR synth-fallback), AFTER the bed is built — a forge failure
 *  never skips the vocal (b). withVocals produces a sung take unless singing is
 *  genuinely unavailable (AFROONE_SINGING_ENABLED off), the ONE legit no-sing
 *  case, which errors CLEARLY and never ships a silent instrumental as a song (c).
 *
 * Source-inspection + pure-function (mirrors the own-engine predicates exactly);
 * no DB, no network. Run:
 *   pnpm --filter @afrohit/worker exec tsx scripts/test-afroone-reliable-sing.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forgeKitFor,
  GENRE_KIT_KEYS,
} from "@afrohit/shared";
import { afroOneSingingEnabled } from "@afrohit/ai";
import { forgePromptFor } from "../src/lib/forge-prompts";

const ownEngineSrc = readFileSync(
  join(__dirname, "..", "src", "processors", "own-engine.ts"),
  "utf-8"
);
const singingSrc = readFileSync(
  join(__dirname, "..", "..", "..", "packages", "ai", "src", "afroone-singing.ts"),
  "utf-8"
);

// ── richMissing MIRROR (own-engine.ts exactly, incl. the rejected-forge cooldown)
// The lane's core real kit the FORGEON stage renders: requested roles first, then
// forgeKitFor(12) priority, 'fill' excluded, only roles the shelf LACKS (no
// double-forge), only forgeable roles, roles NOT in a rejected-forge cooldown,
// capped per render.
const richMissingFor = (
  genre: string,
  shelfRoles: readonly string[],
  requestedRoles: readonly string[] = [],
  cap = 8,
  cooldown: ReadonlySet<string> = new Set()
): string[] => {
  const have = new Set(shelfRoles);
  return [...requestedRoles, ...forgeKitFor(genre, 12)]
    .filter((role, i, arr) => arr.indexOf(role) === i)
    .filter(role => role !== "fill")
    .filter(role => !have.has(role))
    .filter(role => Boolean(forgePromptFor(role, genre, 110, "A minor")))
    .filter(role => !cooldown.has(role))
    .slice(0, cap);
};

/** Every forgeable, non-fill role for a lane — the full reusable kit that a lane
 *  forges ONCE across its lifetime (cap = Infinity ⇒ the whole thing). */
const fullForgeableKit = (genre: string): string[] =>
  richMissingFor(genre, [], [], Number.MAX_SAFE_INTEGER);

/** Simulate a lane's forge spend render after render: each SUCCESSFUL forge lands
 *  on the shelf and is reused, so the next render only forges what is still
 *  missing. Returns the per-render forge lists and the accumulated shelf. */
function simulateLane(genre: string, cap = 8) {
  const shelf = new Set<string>();
  const forgedPerRender: string[][] = [];
  const everForged: string[] = [];
  for (let render = 0; render < 12; render += 1) {
    const toForge = richMissingFor(genre, [...shelf], [], cap);
    forgedPerRender.push(toForge);
    if (toForge.length === 0) break;
    for (const role of toForge) {
      // A role must NEVER be forged twice in a lane (that IS the re-forge leak).
      assert.ok(
        !shelf.has(role),
        `[${genre}] role '${role}' was forged twice — re-forge leak (pay once per lane, then reuse)`
      );
      shelf.add(role);
      everForged.push(role);
    }
  }
  return { forgedPerRender, everForged, shelf };
}

// ── bed-provenance MIRROR (own-engine.ts exactly) ───────────────────────────
// The vocal rides over the FORGED real-instrument bed when any real (forged/
// collected/licensed) loop landed, else the SYNTH-FALLBACK bed. picks' effective
// roleEvidence is 'synth-code' only for the synth floor.
const bedProvenanceOf = (
  picks: ReadonlyArray<{ roleEvidence: string }>
): string =>
  picks.some(pick => pick.roleEvidence !== "synth-code")
    ? "forged (real instruments)"
    : "synth-fallback";

function main() {
  // ══════════════════════════════════════════════════════════════════════════
  // FIX 1 — FORGE ONCE PER LANE, THEN REUSE
  // ══════════════════════════════════════════════════════════════════════════

  // (a) TWO RENDERS, SAME LANE → THE SECOND RE-FORGES 0 SHELVED ROLES. A forged
  // loop persists (source 'forged', readiness 'ready', qualityState 'passed') and
  // pickKit re-selects it, so render 2 NEVER re-forges anything render 1 landed —
  // re-forging shelved loops WAS the ~$0.80/song leak. It forges only never-yet-
  // forged roles the per-render cap (8) could not reach on render 1, and once the
  // lane's whole kit is shelved EVERY render forges 0 (complete reuse). AfroHit's
  // kits are richer than one render, so a lane fills over 2-3 renders (8 → tail →
  // 0), each role forged EXACTLY ONCE — never re-forged.
  const cap = 8;
  for (const genre of GENRE_KIT_KEYS) {
    const render1 = richMissingFor(genre, []);
    assert.ok(
      render1.length > 0,
      `[${genre}] a fresh lane forges its core kit on render 1 (${render1.length} loops)`
    );
    const shelfAfter1 = new Set(render1);
    const render2 = richMissingFor(genre, [...shelfAfter1]);
    for (const role of render2) {
      assert.ok(
        !shelfAfter1.has(role),
        `[${genre}] render 2 RE-FORGED a shelved role '${role}' — that is the ~$0.80/song leak`
      );
    }
    // A fully-forged lane forges 0 — the literal "next render forges 0" (reuse).
    const fullKit = fullForgeableKit(genre);
    assert.equal(
      richMissingFor(genre, fullKit).length,
      0,
      `[${genre}] once the kit is shelved the SAME-lane render forges 0 loops (reuses the shelf)`
    );
  }

  // CONVERGENCE for EVERY lane: no role is EVER forged twice, per-render forge
  // count is non-increasing, and the lane reaches 0 forges once its kit is
  // shelved — "forge once per lane" holds even for kits richer than one render.
  let maxRendersToZero = 0;
  let smallestKitLane = { genre: "", size: Number.MAX_SAFE_INTEGER };
  for (const genre of GENRE_KIT_KEYS) {
    const kit = fullForgeableKit(genre);
    if (kit.length < smallestKitLane.size)
      smallestKitLane = { genre, size: kit.length };
    const { forgedPerRender, everForged, shelf } = simulateLane(genre, cap);
    assert.equal(
      new Set(everForged).size,
      everForged.length,
      `[${genre}] no role is forged more than once across the lane's life`
    );
    assert.deepEqual(
      [...shelf].sort(),
      [...kit].sort(),
      `[${genre}] the lane forges its whole kit exactly once, then stops`
    );
    assert.equal(
      forgedPerRender[forgedPerRender.length - 1]!.length,
      0,
      `[${genre}] the lane converges to 0 forges per render (reuse)`
    );
    for (let i = 1; i < forgedPerRender.length; i += 1) {
      assert.ok(
        forgedPerRender[i]!.length <= forgedPerRender[i - 1]!.length,
        `[${genre}] per-render forge count never rises (each render forges only the shrinking gap)`
      );
    }
    // renders until forge spend is 0 (the last entry is the 0-forge render).
    maxRendersToZero = Math.max(maxRendersToZero, forgedPerRender.length - 1);
  }
  console.log(
    `  [reuse] smallest kit '${smallestKitLane.genre}' = ${smallestKitLane.size} loops; every lane reaches 0 forges within ${maxRendersToZero} render(s), each role forged exactly once`
  );

  // (d) PARTIAL SHELF → FORGE ONLY THE GAP. A lane that already holds some of its
  // kit forges strictly the remaining roles — never the roles it already has.
  {
    const genre = "afrobeats";
    const kit = fullForgeableKit(genre);
    assert.ok(kit.length >= 3, "[afrobeats] has a rich kit to partially shelve");
    const held = kit.slice(0, 2); // pretend the first two roles are already shelved
    const gap = richMissingFor(genre, held);
    for (const role of held) {
      assert.ok(
        !gap.includes(role),
        `[afrobeats] a shelved '${role}' is never re-forged (only the gap is forged)`
      );
    }
    for (const role of gap) {
      assert.ok(
        !held.includes(role),
        `[afrobeats] the forge list is strictly the gap, never a held role`
      );
    }
    // The gap ∪ held reconstructs the kit (nothing dropped, nothing doubled).
    assert.deepEqual(
      [...new Set([...held, ...gap])].sort(),
      [...kit].slice(0, held.length + gap.length).sort(),
      "[afrobeats] held ∪ gap = the kit prefix (only-missing-roles is exact)"
    );
  }

  // REJECTED-FORGE COOLDOWN — a role whose forge keeps FAILING QC files a
  // readiness:'rejected' row that pickKit EXCLUDES, so without the cooldown it
  // re-forges (and re-fails) EVERY render (~$0.08 each — the other half of the
  // owner's bill). In a cooldown it is skipped this render.
  {
    const genre = "afrobeats";
    const wouldForge = richMissingFor(genre, []);
    assert.ok(wouldForge.length > 0, "[afrobeats] a fresh lane would forge its kit");
    const failing = wouldForge[0]!; // this role's forge keeps failing QC
    const withCooldown = richMissingFor(genre, [], [], cap, new Set([failing]));
    assert.ok(
      !withCooldown.includes(failing),
      `[afrobeats] a role in the rejected-forge cooldown ('${failing}') is NOT re-forged this render (kills the every-song re-fail leak)`
    );
    // The cooldown SWAPS the doomed role for the next productive one — it never
    // shrinks useful forging (afrobeats' kit is richer than the cap).
    assert.equal(
      withCooldown.length,
      cap,
      "[afrobeats] the cooldown frees the doomed slot for the next missing role (batch stays full, no wasted re-fail)"
    );
  }

  // The own-engine SOURCE must implement exactly this reuse contract.
  assert.ok(
    /const richMissing = \[\.\.\.requestedRoles, \.\.\.forgeKitFor\(p\.genre, 12\)\]/.test(
      ownEngineSrc
    ) &&
      ownEngineSrc.includes(".filter(r => !haveRoles.has(r))"),
    "own-engine forges only roles the shelf lacks (richMissing filters !haveRoles.has(r))"
  );
  assert.ok(
    ownEngineSrc.includes("OWN_ENGINE_FORGE_RETRY_COOLDOWN_MS") &&
      ownEngineSrc.includes(".filter(r => !cooldownRoles.has(r))") &&
      /source: "forged"/.test(ownEngineSrc) &&
      /readiness: "rejected"/.test(ownEngineSrc),
    "own-engine skips re-forging a role with a recent REJECTED forge (rejected-forge cooldown)"
  );
  assert.ok(
    ownEngineSrc.includes("forge cooldown: skipped re-forging"),
    "the cooldown rides an honest render note when it suppresses a re-forge"
  );

  // ══════════════════════════════════════════════════════════════════════════
  // FIX 2 — GUARANTEE THE SINGING STEP (a withVocals song never ends silent)
  // ══════════════════════════════════════════════════════════════════════════

  // (b) A FORGE FAILURE/CAP STILL SINGS OVER THE FALLBACK BED. When forging lands
  // nothing the bed is all-synth ('synth-code') → 'synth-fallback'; when a real
  // loop landed → 'forged'. Either way the vocal rides over it.
  assert.equal(
    bedProvenanceOf([
      { roleEvidence: "synth-code" },
      { roleEvidence: "synth-code" },
    ]),
    "synth-fallback",
    "an all-synth bed (forging landed nothing) is 'synth-fallback' — the song STILL sings over it"
  );
  assert.equal(
    bedProvenanceOf([
      { roleEvidence: "synth-code" },
      { roleEvidence: "provider-prompted-dsp-consistent" },
    ]),
    "forged (real instruments)",
    "any real forged/collected loop in the bed reads as a 'forged' bed"
  );

  // The singing branch runs AFTER the bed is built (forge fan-out → synth
  // backfill → assembly) and is NOT gated on forge success — a fail-soft forge
  // must never skip the vocal.
  const idxForge = ownEngineSrc.indexOf(
    "await forEachPool(richMissing, FORGE_FANOUT_CONCURRENCY"
  );
  const idxSynthBackfill = ownEngineSrc.lastIndexOf("processSynthMaterial({");
  const idxAssemble = ownEngineSrc.lastIndexOf("await processAssembleBeat({");
  const idxSing = ownEngineSrc.indexOf("await processAfroOneSinging({");
  assert.ok(idxForge > 0 && idxSynthBackfill > 0 && idxAssemble > 0 && idxSing > 0);
  assert.ok(
    idxForge < idxSing &&
      idxSynthBackfill < idxSing &&
      idxAssemble < idxSing,
    "the singing step runs AFTER the forge/synth/assembly — it sings over whatever bed exists"
  );
  // The singer is handed the FINAL bed url (forged or synth-fallback), not a
  // forge-gated one.
  const singBlock = ownEngineSrc.slice(idxSing, idxSing + 600);
  assert.ok(
    singBlock.includes("instrumentalUrl: finalUrl"),
    "afroone-singing runs over the final bed (finalUrl) regardless of the forge outcome"
  );
  assert.ok(
    ownEngineSrc.includes("const bedProvenance = bedHasRealInstruments") &&
      ownEngineSrc.includes(
        "singing: genuine vocal generated, verified, and mixed over the owned "
      ) &&
      ownEngineSrc.includes("a forge failure never skips the vocal"),
    "a receipt line states the song sang and over which bed (forged vs synth-fallback)"
  );
  assert.ok(
    /bed: bedProvenance/.test(ownEngineSrc),
    "the singing receipt carries the bed provenance so the operator sees what it sang over"
  );

  // (c) withVocals GUARANTEES A SUNG OUTPUT unless singing is genuinely
  // unavailable (flag off), which errors CLEARLY — never a silent instrumental.
  assert.equal(
    afroOneSingingEnabled({ AFROONE_SINGING_ENABLED: "1" } as NodeJS.ProcessEnv),
    true,
    "the singing route is available only when AFROONE_SINGING_ENABLED is armed"
  );
  assert.equal(
    afroOneSingingEnabled({} as NodeJS.ProcessEnv),
    false,
    "the singing route is OFF when the flag is unset — the one legit no-sing case"
  );
  // The AI singer itself refuses to render when the flag is off.
  assert.ok(
    /if \(!afroOneSingingEnabled\(env\)\) \{\s*throw new Error\('afroone_singing_disabled'\);/.test(
      singingSrc
    ),
    "renderAfroOneSinging throws 'afroone_singing_disabled' when the route is off"
  );
  // own-engine surfaces the flag-off case EARLY and CLEARLY, before spending any
  // forge time/credits, and refuses to ship a silent instrumental as a song.
  assert.ok(
    ownEngineSrc.includes(
      'if (p.withVocals && process.env.AFROONE_SINGING_ENABLED !== "1")'
    ) &&
      ownEngineSrc.includes("refusing to ship a silent instrumental as a sung song"),
    "a withVocals render with the singing route off fails CLEARLY and early — never a silent instrumental"
  );
  const idxEarlyGuard = ownEngineSrc.indexOf(
    'if (p.withVocals && process.env.AFROONE_SINGING_ENABLED !== "1")'
  );
  assert.ok(
    idxEarlyGuard > 0 && idxEarlyGuard < idxForge,
    "the singing-availability guard runs BEFORE forging (no forge spend on a render that can never sing)"
  );
  // A withVocals song requires real lyrics + a composed melody score — a "song"
  // is genuinely sung, never a bed relabeled as one.
  assert.ok(
    ownEngineSrc.includes('throw new Error("own-engine singing requested without lyrics")') &&
      ownEngineSrc.includes(
        'throw new Error("own-engine singing requested without a valid melody score")'
      ),
    "withVocals demands lyrics + a melody score — the sung take is the real product"
  );
  // A transient singer failure fails LOUDLY (refuses silent), it does not ship
  // the instrumental as the song.
  assert.ok(
    ownEngineSrc.includes("not shipping a silent instrumental as a sung song"),
    "a singer failure refuses to ship a silent instrumental as a sung song (fails loud)"
  );

  console.log(
    `afroone-reliable-sing: forge ONCE per lane then reuse — a fresh lane forges its kit, every subsequent render forges only the shrinking gap and re-forges ZERO shelved loops, a fully-forged lane forges 0, all ${GENRE_KIT_KEYS.length} lanes reach 0 within ${maxRendersToZero} render(s) with no role forged twice, and a rejected-forge cooldown kills the every-song re-fail leak; and the singing step is GUARANTEED for withVocals — it runs over whatever bed exists (forged or synth-fallback, a forge failure never skips the vocal), with a bed-provenance receipt, and the only no-sing case (AFROONE_SINGING_ENABLED off) errors clearly instead of shipping a silent instrumental — all enforced.`
  );
}

main();
