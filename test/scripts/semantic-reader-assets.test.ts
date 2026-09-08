import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-expect-error public frozen reading package seam
import { buildReaderAssetBundle } from '../../scripts/semantic-reader-assets.mjs';
// @ts-expect-error browser loading boundary
import { createReaderAssetLoader } from '../../scripts/semantic-reader-loader.mjs';

function fixture() {
  const source = 'function run() { return 1; }', digest = createHash('sha256').update(source).digest('hex');
  return { schema: 'reader-snapshot-v1', repository: 'r', snapshot: 's', overlayHash: 'o',
    files: [{ path: 'a.ts', source_digest: digest, source, verified: true }],
    definitions: [{ definition_key: 'a', snapshot_id: 's', qualified_name: 'run', kind: 'function', file_path: 'a.ts', content_hash: digest, definition_span: { start_byte: 0, end_byte: source.length }, evidence_ids: ['e'] }], facts: [],
    evidence: { e: { evidence_id: 'e', snapshot_id: 's', file_path: 'a.ts', source_digest: digest, span: { start_byte: 0, end_byte: source.length } } } };
}

test('a lightweight reader opens before source or Evidence and can retry corrupted resources without mixing versions', async () => {
  const original = fixture(), bundle = buildReaderAssetBundle(original);
  assert.equal(bundle.bootstrap.files[0].source, null);
  assert.deepEqual(bundle.bootstrap.evidence, {});
  const requests: string[] = [];
  let corrupt = true;
  const loader = createReaderAssetLoader(bundle.bootstrap, async (url: string) => {
    requests.push(url); const text = bundle.assets.find((a: any) => a.path === url).content;
    return corrupt ? text + ' ' : text;
  });
  assert.equal(requests.length, 0);
  await assert.rejects(loader.source('a.ts'), /RESOURCE_INTEGRITY/);
  assert.equal(bundle.bootstrap.files[0].source, null);
  corrupt = false;
  await loader.source('a.ts');
  await loader.evidence(['e']);
  assert.equal(bundle.bootstrap.files[0].source, original.files[0].source);
  assert.deepEqual(bundle.bootstrap.evidence, original.evidence);
  assert.equal(loader.status().sources, 1);
});

test('facts load for the requested definition and full loading preserves original order and Evidence', async () => {
  const original: any = fixture();
  original.facts = [
    { fact_id: 'call', snapshot_id: 's', kind: 'call_target', subject: { kind: 'definition', definition_key: 'a' }, basis: { kind: 'static_possible' }, evidence_ids: ['e'], value: { target_definition_key: 'a', call_site_evidence_id: 'e' } },
    { fact_id: 'control', snapshot_id: 's', kind: 'control_flow', subject: { kind: 'definition', definition_key: 'a' }, basis: { kind: 'static_possible' }, evidence_ids: ['e'], value: { blocks: [{ id: 0, kind: 'return', evidence_id: 'e' }], edges: [] } },
  ];
  const bundle = buildReaderAssetBundle(original);
  assert.deepEqual(bundle.bootstrap.facts, []);
  const loader = createReaderAssetLoader(bundle.bootstrap, async (url: string) => bundle.assets.find((a: any) => a.path === url).content);
  assert.equal(loader.hasDefinition('a'), false);
  await loader.definition('a');
  assert.equal(loader.hasDefinition('a'), true);
  assert.deepEqual(bundle.bootstrap.facts, original.facts);
  await loader.all();
  assert.equal(loader.hasCalls(), true);
  assert.deepEqual(bundle.bootstrap.facts, original.facts);
  assert.deepEqual(bundle.bootstrap.evidence, original.evidence);
});

test('historical missing Evidence can remain a review gap even when its shard prefix exists', async () => {
  const original: any = fixture();
  original.evidence = { abcNew: { ...original.evidence.e, evidence_id: 'abcNew' } };
  original.definitions[0].evidence_ids = ['abcNew'];
  const bundle = buildReaderAssetBundle(original);
  const loader = createReaderAssetLoader(bundle.bootstrap, async (url: string) => bundle.assets.find((a: any) => a.path === url).content);
  assert.deepEqual(await loader.evidence(['abcOld'], { allowMissing: true }), [undefined]);
  assert.equal(Object.hasOwn(bundle.bootstrap.evidence, 'abcOld'), false);
  await assert.rejects(loader.evidence(['abcOld']), /EVIDENCE_MISSING/);
});
