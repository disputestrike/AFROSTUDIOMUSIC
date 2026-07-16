/**
 * TENANT SURFACE ISOLATION (Wave 8a) — pure manifest test.
 *
 * Transpiles lib/nav-manifest.ts (no React, no client code) and asserts the
 * law of the manifest: the consumer set NEVER intersects the operator-only
 * set, the consumer nav is exactly the Suno-shaped list, and deep-link gating
 * covers every operator surface (list-only for /projects).
 *
 * Run: pnpm --filter @afrohit/web test:nav-manifest
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/nav-manifest.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const dir = mkdtempSync(join(tmpdir(), 'afrohit-nav-manifest-'));
const file = join(dir, 'nav-manifest.mjs');
writeFileSync(file, outputText);

try {
  const manifest = await import(pathToFileURL(file).href);
  const { NAV_MANIFEST, consumerNav, operatorOnlyNav, navItemsFor, isOperatorGatedPath, OPERATOR_GATED_PAGES } = manifest;

  // Every entry is complete and hrefs are unique.
  for (const item of NAV_MANIFEST) {
    assert.ok(item.href?.startsWith('/'), `href must be a path: ${JSON.stringify(item)}`);
    assert.ok(item.label?.length > 0, `label required: ${JSON.stringify(item)}`);
    assert.ok(['all', 'operator'].includes(item.audience), `audience must be declared: ${JSON.stringify(item)}`);
  }
  assert.equal(new Set(NAV_MANIFEST.map((i) => i.href)).size, NAV_MANIFEST.length, 'duplicate hrefs in manifest');

  // THE LAW: consumer set never intersects the operator-only set.
  const consumerHrefs = new Set(consumerNav().map((i) => i.href));
  const operatorHrefs = new Set(operatorOnlyNav().map((i) => i.href));
  for (const href of consumerHrefs) {
    assert.ok(!operatorHrefs.has(href), `surface in BOTH audiences: ${href}`);
  }
  assert.equal(consumerHrefs.size + operatorHrefs.size, NAV_MANIFEST.length, 'every surface belongs to exactly one audience');

  // The consumer app is Suno-shaped: exactly these surfaces, nothing internal.
  assert.deepEqual(
    consumerNav().map((i) => [i.href, i.label]),
    [
      ['/create', 'Create'],
      ['/voice', 'My Voice'],
      ['/likeness', 'My Likeness'],
      ['/listen', 'Listen'],
      ['/studio', 'Chat'],
      ['/catalog', 'Catalog'],
      ['/albums', 'Albums'],
      ['/billing', 'Billing'],
      ['/settings', 'Settings'],
    ],
    'consumer nav must be exactly the approved Suno-shaped set'
  );

  // The engine room stays with the operator: exactly these surfaces.
  assert.deepEqual(
    [...operatorHrefs].sort(),
    ['/admin', '/benchmark', '/instrumentals', '/lake', '/lexicon', '/materials', '/projects', '/zap'].sort(),
    'operator-only set must be exactly the engine room'
  );

  // Role routing: consumers get only the consumer set; the operator gets everything.
  assert.deepEqual(navItemsFor(false), consumerNav());
  assert.deepEqual(navItemsFor(true), [...NAV_MANIFEST]);
  for (const item of navItemsFor(false)) {
    assert.notEqual(item.audience, 'operator', `operator surface leaked into consumer nav: ${item.href}`);
  }

  // Deep-link gating covers every operator surface; /projects gates the LIST only.
  assert.deepEqual([...OPERATOR_GATED_PAGES].sort(), [...operatorHrefs].sort());
  for (const href of operatorHrefs) {
    assert.ok(isOperatorGatedPath(href), `gate must cover ${href}`);
  }
  assert.ok(isOperatorGatedPath('/lake/anything'), 'subpaths of operator surfaces stay gated');
  assert.ok(!isOperatorGatedPath('/projects/abc123'), 'project DETAIL pages are consumer-reachable');
  assert.ok(!isOperatorGatedPath('/projects/new'), 'new-project page is consumer-reachable');
  for (const href of consumerHrefs) {
    assert.ok(!isOperatorGatedPath(href), `consumer surface must never be gated: ${href}`);
  }

  console.log(
    `nav manifest: ${consumerHrefs.size} consumer + ${operatorHrefs.size} operator-only surfaces, zero intersection`
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
