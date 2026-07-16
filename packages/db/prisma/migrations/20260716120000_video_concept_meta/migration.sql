-- ONE-CLICK FULL VIDEO (Wave 10): the auto-assemble request lives ON the
-- concept — meta.autoAssemble = { requested, kind, engineClass, ... }.
-- POST /videos/render-all stamps it after the one upfront charge; the worker
-- single-fires the assemble-video job when every sequence has a render, or
-- writes an honest outcome ('incomplete' + missing list) when terminal
-- failures leave coverage short. Purely additive; nullable; no row changes
-- meaning. Guarded so re-running is safe.

ALTER TABLE "VideoConcept" ADD COLUMN IF NOT EXISTS "meta" JSONB;
