import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error standalone public reader model
import { queryReader } from '../../scripts/semantic-reader-query.mjs';
const data = { snapshot: 's', definitions: [{ definition_key: 'a', qualified_name: 'parse' }, { definition_key: 'b', qualified_name: 'parse' }], mainlines: [{ id: 'flow', title: '解析', available: true, snapshot: 's', stages: [{ keys: ['a'], refs: [{ snapshot: 's', excerpt: 'parse()' }] }] }] };
const capabilities = { list: () => [{ id: 'c', title: '验证', available: true }], members: () => ['a'] };
const risk = { impact: (key: string) => ({ root: key, snapshot: 's', paths: [], completeness: { status: 'partial' } }) };
test('controlled questions reuse entries and bounded impact, and require name disambiguation', () => {
  const entry = queryReader(data, '解析从哪里进入', { capabilities, risk });
  assert.equal(entry.status, 'answered');
  assert.equal(entry.snapshot, 's');
  assert.equal(entry.objects[0].key, 'flow');
  assert.equal(entry.evidence[0].excerpt, 'parse()');
  const ambiguous = queryReader(data, 'parse可能影响哪里', { capabilities, risk });
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.objects.length, 2);
  assert.equal(queryReader(data, 'parse可能影响哪里', { capabilities, risk, selectedKey: 'a' }).impact.root, 'a');
  assert.equal(queryReader(data, '支付从哪里进入', { capabilities, risk }).status, 'no_match');
  assert.equal(queryReader(data, '为何线上请求失败？', { capabilities, risk }).status, 'unsupported');
  assert.equal(queryReader({ ...data, snapshot: 'new' }, '解析从哪里进入', { capabilities, risk }).status, 'no_match');
});
