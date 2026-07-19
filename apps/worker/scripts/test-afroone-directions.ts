import assert from "node:assert/strict";
import {
  AFROONE_DIRECTIONS,
  AFROONE_RENDER_SPEC_VERSION,
  afroOneDirectionsForRequest,
  applyAfroOneDirection,
  deriveAfroOneSeed,
} from "@afrohit/shared";

const sections = [
  { name: "intro", bars: 4, roles: ["kick", "shaker", "bass", "piano", "guitar"] },
  { name: "verse", bars: 16, roles: ["kick", "snare", "shaker", "bass", "piano", "guitar"] },
  { name: "hook", bars: 8, roles: ["kick", "snare", "shaker", "bass", "piano"] },
];
const roles = ["kick", "snare", "shaker", "bass", "piano", "guitar", "fill"];

const commercial = applyAfroOneDirection(sections, "commercial_safe", roles);
const spacious = applyAfroOneDirection(sections, "spacious_restrained", roles);
const energetic = applyAfroOneDirection(sections, "energetic_hook_forward", roles);

assert.equal(AFROONE_RENDER_SPEC_VERSION, "afroone-render-v1");
assert.deepEqual(afroOneDirectionsForRequest(undefined, 3), AFROONE_DIRECTIONS);
assert.deepEqual(
  afroOneDirectionsForRequest(["spacious_restrained", "spacious_restrained"], 3),
  ["spacious_restrained"],
  "explicit direction requests are deduplicated and outrank candidate count"
);
assert.ok(
  spacious.find(section => section.name === "verse")!.roles.length <
    commercial.find(section => section.name === "verse")!.roles.length,
  "spacious direction removes density"
);
assert.ok(
  energetic.find(section => section.name === "hook")!.roles.length >
    spacious.find(section => section.name === "hook")!.roles.length,
  "hook-forward direction creates a larger hook arrival"
);
assert.ok(
  energetic.find(section => section.name === "hook")!.energy! >
    commercial.find(section => section.name === "hook")!.energy!,
  "hook-forward direction raises hook energy"
);
assert.equal(
  deriveAfroOneSeed(12345, "commercial_safe"),
  deriveAfroOneSeed(12345, "commercial_safe"),
  "same seed and direction replay exactly"
);
assert.notEqual(
  deriveAfroOneSeed(12345, "commercial_safe"),
  deriveAfroOneSeed(12345, "spacious_restrained"),
  "direction identity produces a distinct deterministic seed"
);

console.log("AfroOne controlled directions and deterministic seed contracts passed");
