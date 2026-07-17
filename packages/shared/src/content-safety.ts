/**
 * CONTENT-ABUSE GATE (audit 2026-07-17). Free-text that reaches image/video
 * engines or public pages is an abuse surface: real-person likenesses,
 * copyrighted characters, hate/graphic content, and phishing text. This is a
 * lightweight FIRST-LINE filter (the engines have their own policies too) —
 * cheap, honest, and non-blocking on ambiguity: it flags only high-confidence
 * violations so legitimate Afrobeats treatments always pass.
 */
const BANNED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  // Real public figures by role (a treatment casts the ARTIST, never these).
  { re: /\b(president|prime minister|the pope|royal family|king charles|queen elizabeth)\b/i, reason: "real public figure" },
  // Copyrighted characters commonly attempted.
  { re: /\b(mickey mouse|spider-?man|batman|superman|pikachu|harry potter|darth vader|elsa|marvel|disney)\b/i, reason: "copyrighted character" },
  // Graphic / illegal content the engines reject anyway — fail fast, honestly.
  { re: /\b(child|minor|underage)\b.{0,20}\b(nude|sexual|explicit)\b/i, reason: "prohibited content" },
  { re: /\bgore|beheading|dismember|terrorist attack\b/i, reason: "graphic violence" },
];

export interface ContentCheck {
  ok: boolean;
  reason?: string;
}

/** Check free-text destined for a generative engine or a public surface.
 *  Empty/short text always passes. */
export function checkGenerativeContent(text: string | null | undefined): ContentCheck {
  if (!text || text.trim().length < 3) return { ok: true };
  for (const { re, reason } of BANNED_PATTERNS) {
    if (re.test(text)) return { ok: false, reason };
  }
  return { ok: true };
}
