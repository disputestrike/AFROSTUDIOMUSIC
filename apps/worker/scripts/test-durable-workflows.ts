import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  recordLlmUsage,
  runWithLlmUsageContext,
  setLlmUsageSink,
  type AttributedLlmCallRecord,
} from '../../../packages/ai/src/llm-usage';
import { scopedRequestKey } from '../../api/src/lib/queued-job';

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

async function main() {
  assert.equal(scopedRequestKey({ 'idempotency-key': 'request_123' }, 'music'), 'music:request_123');
  assert.equal(scopedRequestKey({ 'idempotency-key': 'bad key' }, 'music'), undefined);
  assert.equal(scopedRequestKey({ 'idempotency-key': 'x'.repeat(129) }, 'music'), undefined);

  let recorded: AttributedLlmCallRecord | undefined;
  setLlmUsageSink((value) => { recorded = value; });
  await runWithLlmUsageContext(
    { workspaceId: 'workspace-a', userId: 'user-a', requestId: 'request-a', jobId: 'job-a' },
    async () => {
      await Promise.resolve();
      recordLlmUsage({ tier: 'bulk', task: 'test', brain: 'test', ms: 12, estCostUsd: 0.01 });
    }
  );
  assert.equal(recorded?.workspaceId, 'workspace-a');
  assert.equal(recorded?.userId, 'user-a');
  assert.equal(recorded?.requestId, 'request-a');
  assert.equal(recorded?.jobId, 'job-a');

  const repo = join(process.cwd(), '..', '..');
  const schema = readFileSync(join(repo, 'packages/db/prisma/schema.prisma'), 'utf8');
  assert.match(schema, /model JobOutbox/);
  assert.match(schema, /chargeLedgerId\s+String\?\s+@unique/);
  assert.match(schema, /reversalOfId\s+String\?\s+@unique/);
  assert.match(schema, /model BillingIntent/);
  assert.match(schema, /paypalEventId\s+String\s+@unique/);
  assert.match(schema, /model BillingEvent[\s\S]*attempts\s+Int\s+@default\(1\)[\s\S]*processingAt\s+DateTime\?/);
  assert.match(schema, /model TasteScore[\s\S]*lyricId\s+String\?/);
  assert.match(schema, /@@unique\(\[workspaceId, kind, idempotencyKey\]\)/);

  const receiptHelper = readFileSync(join(repo, 'apps/api/src/lib/idempotent-operation.ts'), 'utf8');
  assert.match(receiptHelper, /operationFingerprint/);
  assert.match(receiptHelper, /chargeLedgerId/);
  assert.match(receiptHelper, /reversal:\s*null/);
  assert.match(receiptHelper, /outputJson:\s*\{ value:/);

  const apiRoot = join(repo, 'apps/api/src');
  const rawEnqueues = sourceFiles(apiRoot)
    .filter((path) => !path.endsWith(join('lib', 'queued-job.ts')) && !path.endsWith(join('lib', 'queue.ts')))
    .filter((path) => /\benqueue\s*\(/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(repo, path));
  assert.deepEqual(rawEnqueues, [], `raw API queue writes bypass outbox: ${rawEnqueues.join(', ')}`);

  const apiIndex = readFileSync(join(apiRoot, 'index.ts'), 'utf8');
  const workerIndex = readFileSync(join(repo, 'apps/worker/src/index.ts'), 'utf8');
  const projectRoutes = readFileSync(join(apiRoot, 'routes/projects.ts'), 'utf8');
  const chatRoutes = readFileSync(join(apiRoot, 'routes/chat.ts'), 'utf8');
  const chatTools = readFileSync(join(apiRoot, 'services/chat-tools.ts'), 'utf8');
  assert.doesNotMatch(apiIndex, /workspace\.findFirst\(\{\s*select:\s*\{\s*id:\s*true/);
  assert.doesNotMatch(workerIndex, /workspace\.findFirst\(\{\s*select:\s*\{\s*id:\s*true/);
  assert.match(apiIndex, /workspaceId:\s*workspaceId\s*\?\?\s*null/);
  assert.match(workerIndex, /runWithLlmUsageContext/);
  assert.match(projectRoutes, /where:\s*\{\s*id:\s*artistId,\s*workspaceId\s*\}/);
  assert.match(projectRoutes, /where:\s*\{\s*id:\s*data\.artistId,\s*workspaceId\s*\}/);
  assert.match(chatRoutes, /kind:\s*'chat-message'/);
  assert.match(chatRoutes, /kind:\s*'chat-message-stream'/);
  assert.match(chatTools, /kind:\s*`chat-tool:\$\{args\.name\}`/);

  for (const route of ['briefs.ts', 'hooks.ts', 'lyrics.ts', 'taste.ts', 'zap.ts', 'admin.ts', 'songs.ts', 'materials.ts']) {
    const source = readFileSync(join(apiRoot, 'routes', route), 'utf8');
    assert.match(source, /runIdempotentOperation/, `${route} is missing synchronous operation receipts`);
  }

  const webApi = readFileSync(join(repo, 'apps/web/lib/api.ts'), 'utf8');
  const bff = readFileSync(join(repo, 'apps/web/app/backend/[...path]/route.ts'), 'utf8');
  assert.match(webApi, /'idempotency-key': crypto\.randomUUID\(\)/);
  assert.match(webApi, /const idempotencyKey = crypto\.randomUUID\(\);[\s\S]*fetchWithRetry[\s\S]*'idempotency-key': idempotencyKey/);
  assert.match(bff, /idempotency-key/);

  console.log('durable workflows: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
