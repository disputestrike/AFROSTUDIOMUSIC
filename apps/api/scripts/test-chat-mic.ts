/**
 * CHAT MIC — proof (2026-07-18).
 *
 * Owner: "you deleted the microphone." Verified false (StudioChat.tsx was never
 * in the change set), but the mic was gated ONLY on the browser Web Speech API
 * (getSpeechRecognition), which Firefox/Safari don't support — so the button
 * vanished there. This pins the real fix: the mic works on EVERY browser via a
 * server-side transcription fallback (MediaRecorder -> OpenAI whisper), per the
 * owner's "we can use OpenAI for the mic."
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const chat = read("src/routes/chat.ts");
const studioChat = read("../web/components/StudioChat.tsx");

// ── Server: a transcription endpoint on the brain's provider ─────────────────
assert.match(
  chat,
  /import \{ prompts, studioChat, transcribeAudio \} from '@afrohit\/ai'/,
  "server imports the transcription helper"
);
assert.match(chat, /app\.post\(\s*\r?\n?\s*'\/transcribe'/, "POST /chat/transcribe exists");
assert.match(
  chat,
  /transcribeAudio\(\{ bytes, filename: `voice\.\$\{ext\}` \}\)/,
  "the endpoint transcribes the posted audio bytes (OpenAI whisper)"
);
assert.match(chat, /requireAuth\(req\)/, "the transcribe endpoint is authed");

// ── Client: the mic shows on Firefox and records -> server transcription ─────
assert.match(
  studioChat,
  /typeof MediaRecorder !== 'undefined'/,
  "micAvailable is true when MediaRecorder exists (Firefox/Safari), not only Web Speech"
);
assert.match(
  studioChat,
  /async function recordAndTranscribe\(\)/,
  "the MediaRecorder fallback path exists"
);
assert.match(
  studioChat,
  /api\.post<\{ text: string \}>\('\/chat\/transcribe'/,
  "the recorded clip is sent to the server for transcription"
);
// toggleMic: browser Web Speech first, else the recorder fallback.
const srAt = studioChat.indexOf("const rec = getSpeechRecognition();");
const fallbackAt = studioChat.indexOf("void recordAndTranscribe();");
assert.ok(
  srAt >= 0 && fallbackAt > srAt,
  "toggleMic uses live Web Speech when present, else falls back to record+transcribe"
);

console.log(
  "chat mic: server /transcribe (OpenAI) + a MediaRecorder fallback so the mic works on Firefox/Safari, not only Chrome"
);
