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

test('Chinese responsibilities locate source without promoting search matches to confirmed entries', () => {
  const bundle = {
    ...data,
    files: [{ path: 'src/indexer.ts', verified: true, source_digest: 'hash', presentation: { snapshot: 's', source_digest: 'hash', purpose: '构建项目索引', basis: 'llm_inferred', verified: false } }],
    definitions: [{ definition_key: 'index', snapshot_id: 's', kind: 'function', qualified_name: 'buildIndex', file_path: 'src/indexer.ts', content_hash: 'fn-hash',
      presentation: { snapshot: 's', definition_key: 'index', source_digest: 'hash', content_hash: 'fn-hash', purpose: '索引源码并更新数据库', basis: 'llm_inferred', verified: false } }],
  };
  const result = queryReader(bundle, '索引', { capabilities, risk });
  assert.equal(result.intent, 'search');
  assert.equal(result.status, 'answered');
  assert.ok(result.objects.some((o: any) => o.key === 'index' && o.type === 'fn'));
  assert.equal(result.objects.find((o: any) => o.key === 'index').entryStatus, 'related_implementation');
  assert.equal(result.objects.find((o: any) => o.key === 'index').basis, 'llm_inferred');
  const stale = structuredClone(bundle); stale.definitions[0].presentation.snapshot = 'old'; stale.files[0].presentation.snapshot = 'old';
  assert.equal(queryReader(stale, '索引', { capabilities, risk }).status, 'no_match');
});

test('unsupported questions return related implementations and reviewed aliases expire with their source version', () => {
  const bundle = { ...data,
    files: [{ path: 'src/context.ts', verified: true, source_digest: 'hash' }],
    definitions: [{ definition_key: 'dedup', snapshot_id: 's', kind: 'function', qualified_name: 'calculateRemaining', file_path: 'src/context.ts', content_hash: 'fn-hash',
      presentation: { snapshot: 's', definition_key: 'dedup', source_digest: 'hash', content_hash: 'fn-hash', purpose: '去除重复上下文，文件指纹变化时重新发送内容。' } }],
    searchAliases: [{ text: '上下文去重', type: 'fn', key: 'dedup', snapshot: 's', source_digests: { 'src/context.ts': 'hash' }, review: { actor: 'maintainer', reason: '核对源码用途' } }],
  };
  const answer = queryReader(bundle, '文件内容变化后如何避免发送重复上下文？', { capabilities, risk });
  assert.equal(answer.status, 'unsupported');
  assert.equal(answer.fallback, 'related_objects_only');
  assert.equal(answer.objects[0].key, 'dedup');
  const alias = queryReader(bundle, '上下文去重', { capabilities, risk });
  assert.equal(alias.objects[0].basis, 'reviewed_alias');
  assert.equal(alias.objects[0].entryStatus, 'related_implementation');
  bundle.searchAliases[0].snapshot = 'old';
  assert.ok(queryReader(bundle, '上下文去重', { capabilities, risk }).objects.every((o: any) => o.basis !== 'reviewed_alias'));
});

test('questions can find version-bound behavior details and mainline conditions beyond the one-line purpose', () => {
  const bundle = { snapshot: 's', files: [{ path: 'a.ts', verified: true, source_digest: 'h' }],
    definitions: [{ definition_key: 'x', snapshot_id: 's', kind: 'function', qualified_name: 'run', file_path: 'a.ts', content_hash: 'fh',
      presentation: { snapshot: 's', source_digest: 'h', definition_key: 'x', content_hash: 'fh', purpose: '编排任务', logic: '异常退出时在 finally 中释放锁；未取得锁时提前返回。' } }],
    mainlines: [{ id: 'line', snapshot: 's', available: true, title: '上下文读取', purpose: '准备发送内容', stages: [{ title: '检查残片', description: '剩余正文太短时折叠，保留回指。' }] }],
    searchAliases: [{ text: '任务编排', type: 'fn', key: 'x', snapshot: 's', source_digests: { 'a.ts': 'h' }, review: { actor: 'reader', reason: '源码支持' } }],
  };
  assert.equal(queryReader(bundle, '异常退出怎样释放锁？').objects[0].key, 'x');
  assert.equal(queryReader(bundle, '剩余正文太短时怎么办？').objects[0].key, 'line');
  assert.equal(queryReader(bundle, '任务编排怎样工作？').objects[0].basis, 'reviewed_alias');
  bundle.definitions[0].presentation.snapshot = 'old';
  assert.ok(queryReader(bundle, '异常退出怎样释放锁？').objects.every((o: any) => o.key !== 'x'));
});

test('a matching source-bound mainline also exposes its linked source files without confirming an entry', () => {
  const bundle = { snapshot: 's', files: [{ path: 'handler.ts', verified: true, source_digest: 'h' }], definitions: [],
    mainlines: [{ id: 'filter', snapshot: 's', available: true, title: '数据筛选', purpose: '处理用户条件', stages: [{ keys: [], refs: [{ file: 'handler.ts', source_digest: 'h' }] }] }],
    searchAliases: [{ text: '筛选', type: 'mainline', key: 'filter', snapshot: 's', source_digests: { 'handler.ts': 'h' }, review: { actor: 'reader', reason: '核对当前源码' } }],
  };
  const source = queryReader(bundle, '用户筛选怎样处理？').objects.slice(0, 5).find((o: any) => o.type === 'file');
  assert.equal(source?.key, 'handler.ts');
  assert.equal(source.entryStatus, 'related_implementation');
  assert.match(source.matchReason, /主线.*源码位置/);
  bundle.mainlines[0].snapshot = 'old';
  assert.ok(queryReader(bundle, '用户筛选怎样处理？').objects.every((o: any) => o.type !== 'file'));
});
