import { createHash } from "node:crypto";
import {
  decorateTreatmentShotsForRender,
  storyboardShots,
} from "./video-storyboard";

// ===========================================================================
// PER-SCENE EDIT CACHE-BUST KEY (2026-07-20 — owner's #1 video bug: editing a
// scene, "there should be no rain", did NOT change the rendered cut). The
// render/assembly gates keyed a shot's cached clip on the integer shotIndex
// ALONE, so a changed prompt was silently reused. This hash binds a render to
// the EXACT decorated prompt + negative it was made from; the moment the owner
// edits the shot the hash changes, and the gates treat the stored render as
// STALE and redo just that scene.
//
// SERVER-ONLY (node:crypto): exported on its own package path
// (@afrohit/shared/video-prompt-hash), NEVER from the index barrel, so the web
// client bundle never pulls a node builtin — the same isolation the
// server-url-safety module uses. The pure gate laws (perShotRenders /
// planVideoAssembly / videoRenderAllUsage) stay crypto-free and only COMPARE
// the hashes their server callers compute here.
//
// THE HASH IS TAKEN over the SAME text the worker stamps as meta.shotPrompt:
// the continuity-decorated prompt (decorateTreatmentShotsForRender), NOT the
// cast-subjects fold that happens later at engine-call time (worker shotInput).
// That is exactly what the render route hands the worker as payload.shots, so
// an UNTOUCHED shot's "current" hash computed here equals the hash the worker
// stamped — no spurious re-render, no re-bill.
// ===========================================================================

/** sha256 of a shot's decorated prompt + its negative. JSON-array framing keeps
 *  ("ab","c") distinct from ("a","bc") — the quotes/commas are the separator. */
export function videoShotPromptHash(
  prompt: string,
  negativePrompt?: string | null
): string {
  return createHash("sha256")
    .update(JSON.stringify([prompt ?? "", negativePrompt ?? ""]))
    .digest("hex");
}

/**
 * The CURRENT prompt hash for every shot of a stored storyboard (either shape —
 * the legacy flat array or the full-song treatment's shots[] view), keyed by
 * shot index. The decoration mirrors the render route's payload build, so an
 * unedited shot's current hash equals the hash the worker stamped on its
 * render — and an edited shot's hash no longer matches, marking that render
 * stale.
 */
export function currentShotPromptHashes(
  storyboard: unknown
): Map<number, string> {
  const decorated = decorateTreatmentShotsForRender(
    storyboard,
    storyboardShots(storyboard)
  );
  const hashes = new Map<number, string>();
  decorated.forEach((shot, order) => {
    const raw = (shot as { index?: unknown }).index;
    const index = Number.isInteger(raw) ? (raw as number) : order;
    hashes.set(index, videoShotPromptHash(shot.prompt, shot.negativePrompt));
  });
  return hashes;
}
