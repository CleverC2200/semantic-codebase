import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { applyReaderGuide } from './semantic-reader-guide-build.mjs';
import { createReaderRequirementReview, reviewReaderRequirements } from './semantic-reader-requirements.mjs';
import { buildReaderAssetBundle } from './semantic-reader-assets.mjs';
import { renderReaderData } from './semantic-preview-explorer.mjs';

const [input, catalog, destination] = process.argv.slice(2);
if (!input || !catalog || !destination) throw new Error('Usage: node scripts/run-reader-guide.mjs <frozen-reader.json> <guide.json> <new-output-directory>');
const output = resolve(destination);
const [raw, guideRaw] = await Promise.all([readFile(input, 'utf8'), readFile(catalog, 'utf8')]);
const data = applyReaderGuide(JSON.parse(raw), JSON.parse(guideRaw));
const set = { id: 'codegraph-context-dedup', version: '1', title: '上下文去重规则核对',
  source: '从指定冻结源码整理的阅读条款，非外部业务需求规格。',
  clauses: data.guideRules.map(r => ({ id: r.id, text: r.text, source: r.source })) };
const reviews = await Promise.all(data.guideRules.map(r => createReaderRequirementReview(data, set, {
  id: 'guide-' + data.snapshot + '-' + r.id, clauseId: r.id, decision: 'supported',
  rationale: r.text + ' 请对照所列函数与主线中的条件分支；静态依据不证明实际执行。', condition: r.condition,
  actor: 'Codex', origin: 'llm_inferred', definitionKeys: r.definition_keys, evidenceIds: r.evidence_ids, mainlineId: r.mainline,
})));
data.requirements = { schema: 'reader-requirements-v1', set, reviews: reviews.map(({ recordedAt, ...review }) => review) };
const reviewed = await reviewReaderRequirements(data, data.requirements);
if (reviewed.clauses.some(c => c.proofLevel !== 'static_support' || c.decision !== 'supported')) throw new Error('GUIDE_RULE_UNAVAILABLE: ' + JSON.stringify(reviewed.clauses.map(c => ({ id: c.id, state: c.state, gaps: c.gaps }))));
const bundle = buildReaderAssetBundle(data);
const sha = text => createHash('sha256').update(text).digest('hex');
const receipt = { schema: 'reader-guide-receipt-v1', repository: data.repository, snapshot: data.snapshot, overlayHash: data.overlayHash,
  inputSha256: sha(raw), guideSha256: sha(guideRaw), resources: bundle.assets.length,
  requirements: reviewed.clauses.map(c => ({ id: c.id, state: c.state, proofLevel: c.proofLevel })),
  boundary: '仅整理指定冻结包并校验内容与绑定；未调用模型、执行被索引源码或证明真实业务验收。' };
const html = renderReaderData(bundle.bootstrap, receipt);
receipt.htmlBytes = Buffer.byteLength(html); receipt.htmlSha256 = sha(html);
receipt.resourceBytes = bundle.assets.reduce((n, a) => n + Buffer.byteLength(a.content), 0);
// Refuse to overwrite an earlier acceptance package.
await mkdir(output);
await mkdir(join(output, 'reader-assets'));
for (const asset of bundle.assets) await writeFile(join(output, asset.path), asset.content, { flag: 'wx' });
await writeFile(join(output, 'acceptance.html'), html, { flag: 'wx' });
await writeFile(join(output, 'requirements.json'), JSON.stringify(data.requirements, null, 2), { flag: 'wx' });
await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
console.log(JSON.stringify(receipt));
