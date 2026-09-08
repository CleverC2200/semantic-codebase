import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error public frozen reader projection
import { readerProjectOverview } from '../../scripts/semantic-reader-guide.mjs';

test('project overview leads to source-bound entries and withholds stale recommendations without losing the directory', () => {
  const data = { repository: 'r', snapshot: 's', project: 'Example', coverage: { status: 'partial' },
    files: [{ path: 'src/main.ts', verified: true, source_digest: 'hash' }],
    definitions: [{ definition_key: 'entry', snapshot_id: 's', file_path: 'src/main.ts', language: 'typescript' }],
    overview: { repository: 'r', snapshot: 's', purpose: '解释项目的目的', source_digests: { 'src/main.ts': 'hash' },
      capabilities: [{ id: 'index', title: '索引', description: '提取源码结构', reason: '这里启动完整索引', entry: { type: 'fn', key: 'entry' } }] } };
  const overview = readerProjectOverview(data);
  assert.equal(overview.status, 'available');
  assert.equal(overview.capabilities[0].entry.key, 'entry');
  assert.equal(overview.capabilities[0].status, 'candidate');
  assert.equal(overview.basis, 'llm_inferred');
  assert.deepEqual(overview.scope, { files: 1, definitions: 1, languages: ['typescript'], snapshot: 's', coverage: 'partial' });
  data.overview.snapshot = 'old';
  const stale = readerProjectOverview(data);
  assert.equal(stale.status, 'needs_review');
  assert.equal(stale.capabilities.length, 0);
  assert.equal(stale.fallbackFile, 'src/main.ts');
});
