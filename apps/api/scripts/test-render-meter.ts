/**
 * LIVE RENDER METER — proof (2026-07-17, owner: "do we have a meter…? it
 * doesn't show anything was working").
 *
 * The meter law: everything shown is TRUE. Percent comes ONLY from the
 * engine's own logs; no engine signal → indeterminate motion + elapsed time.
 * The worker persists a heartbeat every poll tick; the assembly endpoint
 * serves in-flight scenes; the modal polls while anything renders and the
 * scenes-chip/meter never fabricates a number.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { progressFromLogs } from "../../../packages/ai/src/providers/video-replicate";

function testEnginePercentLaw(): void {
  assert.equal(progressFromLogs("frame 12/48\n10%\n...\n45% done"), 45, "last engine percent wins");
  assert.equal(progressFromLogs("Sampling 87 %"), 87, "spaced percent parses");
  assert.equal(progressFromLogs("no numbers here"), null, "silent engine → null, never invented");
  assert.equal(progressFromLogs(""), null);
  assert.equal(progressFromLogs(null), null);
  assert.equal(progressFromLogs(undefined), null);
  assert.equal(progressFromLogs("670% overflow nonsense"), null, "impossible percents rejected");
}

function testWiring(): void {
  const adapter = readFileSync(
    join(process.cwd(), "../../packages/ai/src/providers/video-replicate.ts"),
    "utf8"
  );
  assert.match(
    adapter,
    /const progressPct = progressFromLogs\(data\.logs\);[\s\S]{0,300}status: "running",/,
    "running polls must carry the engine-reported percent"
  );

  const worker = readFileSync(
    join(process.cwd(), "../worker/src/processors/video.ts"),
    "utf8"
  );
  assert.match(
    worker,
    /beat\.pollAttempts = attempts;[\s\S]{0,400}beat\.step = "engine-rendering";[\s\S]{0,80}await save\(/,
    "the worker must persist a heartbeat every poll tick"
  );
  assert.match(
    worker,
    /entry\.step = "downloading";\s*await save\(entry\.externalId\);/,
    "the download stage must be visible"
  );
  // PAID-BYTES CONFORM LAW (2026-07-17 live incident: nine finished, paid
  // clips rejected for their shape). A shape mismatch is FIXED locally —
  // conform + re-inspect; every other QC failure stays fatal.
  assert.match(
    worker,
    /if \(!\/aspect ratio does not match\/\.test\(\(error as Error\)\.message \?\? ""\)\) \{\s*throw error;\s*\}\s*bytes = await conformAspect\(bytes, format\);\s*conformed = true;/,
    "aspect mismatch must conform paid bytes, never reject them"
  );
  assert.match(
    worker,
    /aspectConformed: stored\.conformed/,
    "conformed clips must carry honest provenance"
  );
  assert.match(
    worker,
    /vertical:\s*\n?\s*"crop=min\(iw\\\\,ih\*9\/16\):min\(ih\\\\,iw\*16\/9\),scale=720:1280/,
    "vertical conform filter present"
  );
  assert.match(
    worker,
    /if \(typeof render\.progressPct === "number"\) \{\s*beat\.progressPct = render\.progressPct;/,
    "percent is copied only from the engine result — never synthesized"
  );

  const videos = readFileSync(join(process.cwd(), "src/routes/videos.ts"), "utf8");
  assert.match(
    videos,
    /const inFlight = inFlightJobs\.flatMap/,
    "the assembly endpoint must serve in-flight scenes"
  );
  assert.match(
    videos,
    /status: \{ in: \["QUEUED", "RUNNING"\] \},[\s\S]{0,120}NOT: \{ provider: "assembler" \}/,
    "in-flight = queued/running render jobs for this concept"
  );

  const grid = readFileSync(
    join(process.cwd(), "../web/components/CatalogGrid.tsx"),
    "utf8"
  );
  const meterAt = grid.indexOf("const live =");
  assert.ok(meterAt >= 0, "scene meter exists");
  const meter = grid.slice(meterAt, meterAt + 2600);
  assert.match(meter, /live\.progressPct != null \? ` · \$\{live\.progressPct\}%` : ""/, "percent shown only when the engine reported one");
  assert.match(meter, /animate-pulse/, "no engine percent → honest indeterminate motion");
  assert.match(meter, /elapsed/, "elapsed time always shown");
  assert.doesNotMatch(meter, /Math\.random|\+= *\d|setInterval/, "the meter never fakes advancement");
  assert.match(
    grid,
    /if \(!\(assembly\.data\?\.inFlight\?\.length \?\? 0\)\) return;[\s\S]{0,200}setTimeout\(\(\) => void loadAssembly\(conceptId\), 8_000\)/,
    "the modal keeps polling while anything renders"
  );
}

testEnginePercentLaw();
testWiring();
console.log("render meter: engine-percent-only law, worker heartbeat, in-flight feed, and honest UI motion all hold");
