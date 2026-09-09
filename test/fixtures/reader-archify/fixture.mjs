import { createHash } from 'node:crypto';
export function archifyFixture() {
  const snapshot = 'a'.repeat(64), path = 'src/flow.ts';
  const source = 'function start() { finish(); }\nfunction finish() { return 1; }\n';
  const source_digest = createHash('sha256').update(source).digest('hex');
  const first = source.indexOf('\n');
  const spans = [{ start_byte: 0, end_byte: first }, { start_byte: first + 1, end_byte: source.length - 1 }];
  const definitions = ['start', 'finish'].map((name, i) => ({ definition_key: name, qualified_name: name, name, kind: 'function', snapshot_id: snapshot, file_path: path, definition_span: spans[i], evidence_ids: ['e' + i] }));
  const evidence = Object.fromEntries(definitions.map((d, i) => ['e' + i, { evidence_id: 'e' + i, file_path: path, source_digest, span: d.definition_span }]));
  const refs = definitions.map((d, i) => ({ definition_key: d.definition_key, file: path, snapshot, source_digest, startLine: i + 1, endLine: i + 1, excerpt: source.split('\n')[i] }));
  return { schema: 'reader-snapshot-v1', snapshot, overlayHash: 'c'.repeat(64), repository: 'reader-test', repositoryUrl: 'https://github.com/example/repo', revision: 'b'.repeat(40), coverage: { status: 'partial' },
    files: [{ path, verified: true, source, source_digest }], definitions, evidence,
    mainlines: [{ id: 'flow', title: '同步', available: true, snapshot, source_digests: { [path]: source_digest }, stages: [{ id: 'stage', title: '执行', keys: ['start', 'finish'], refs }] }],
    facts: [{ fact_id: 'call', kind: 'call_target', snapshot_id: snapshot, subject: { kind: 'definition', definition_key: 'start' }, value: { target_definition_key: 'finish', call_site_evidence_id: 'e0' }, basis: { kind: 'compiler_exact' }, evidence_ids: ['e0'] }], relations: [], relationCandidates: [] };
}
