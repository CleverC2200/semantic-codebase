import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArchifyProjection } from './semantic-reader-archify.mjs';

const productRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
// Older frozen readers stored source identity only in their adjacent receipt.
// Reuse it only after Snapshot, Overlay and the complete file manifest agree.
export function readArchifyReader(readerPath) {
  const data = JSON.parse(readFileSync(readerPath, 'utf8'));
  if (data.revision) return data;
  const receiptPath = join(dirname(resolve(readerPath)), 'receipt.json');
  if (!existsSync(receiptPath)) return data;
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const manifest = new Map((receipt.files ?? []).map(f => [f.relative_path, f.source_digest]));
  if (receipt.snapshot_id !== data.snapshot || receipt.overlay_hash !== data.overlayHash || manifest.size !== data.files?.length ||
    data.files.some(f => manifest.get(f.path) !== f.source_digest) || !/^[a-f0-9]{40}$/i.test(receipt.source_head ?? '')) throw new Error('旧阅读包的来源收据与 Snapshot、Overlay 或文件清单不一致。');
  return { ...data, revision: receipt.source_head, repositoryUrl: receipt.source_origin ?? data.repositoryUrl ?? null };
}

export function bindArchifyRepository(data, sourceRoot) {
  const root = realpathSync(sourceRoot);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (realpathSync(git('rev-parse', '--show-toplevel')) !== root) throw new Error('来源必须是精确的 Git 仓库根目录。');
  const origin = git('remote', 'get-url', 'origin');
  const normalize = url => String(url).replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://').replace(/\.git\/?$/, '').replace(/\/$/, '');
  const supplied = data.repositoryUrl ?? (/^(https?:|git@|ssh:)/.test(data.repository ?? '') ? data.repository : null);
  if (supplied && normalize(supplied) !== normalize(origin)) throw new Error('阅读包仓库 origin 与来源仓库不匹配。');
  if (!/^[a-f0-9]{40}$/i.test(data.revision ?? '')) throw new Error('阅读包缺少 Git revision；不能以当前 HEAD 代替。');
  if (git('rev-parse', '--verify', data.revision + '^{commit}') !== data.revision) throw new Error('Git revision 不可核对。');
  return { ...data, repositoryUrl: origin };
}

// Publish an immutable directory, so HTML, specification and receipt become visible together.
// Neither a failed attempt nor a successful retry replaces a previous delivery directory.
export async function deliverReaderArchify(data, mainlineId, outputDirectory, sourceRoot, { runner = spawnSync } = {}) {
  const output = resolve(outputDirectory), root = realpathSync(sourceRoot);
  if (existsSync(output)) throw new Error('交付目录已存在；请使用新目录，已有可信产物保持不变。');
  const bound = bindArchifyRepository(data, root);
  const projection = await createArchifyProjection(bound, mainlineId);
  for (const file of projection.sourceFiles) {
    const blob = execFileSync('git', ['-C', root, 'cat-file', 'blob', `${bound.revision}:${file.path}`], { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (digest(blob) !== file.source_digest) throw new Error('冻结源码与 Git revision 内容不一致：' + file.path);
  }
  const archify = join(productRoot, '.agents/skills/archify/bin/archify.mjs');
  if (!existsSync(archify)) throw new Error('项目级 Archify 未安装。');
  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(dirname(output), '.archify-delivery-'));
  try {
    const specBytes = JSON.stringify(projection.spec, null, 2) + '\n';
    const specPath = join(staging, 'diagram.archify.json'), artifactPath = join(staging, 'diagram.html');
    writeFileSync(specPath, specBytes);
    const result = runner(process.execPath, [archify, 'deliver', 'architecture', specPath, artifactPath, '--repo-root', root, '--quality', 'showcase', '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 });
    let toolReceipt;
    try { toolReceipt = JSON.parse(result.stdout); } catch { throw new Error('Archify 没有返回可校验的交付收据：' + (result.stderr ?? result.error?.message ?? '')); }
    if (result.status !== 0 || !toolReceipt.ok) throw new Error(toolReceipt.error ?? result.stderr ?? 'Archify 交付失败。');
    const bytes = readFileSync(artifactPath), specHash = digest(specBytes), artifactHash = digest(bytes);
    if (toolReceipt.specification?.sha256 !== specHash || toolReceipt.artifact?.sha256 !== artifactHash || toolReceipt.artifact.bytes !== bytes.length ||
      toolReceipt.validation?.checksPassed !== 9 || toolReceipt.validation?.checkCount !== 9 || toolReceipt.validation?.errors !== 0 || toolReceipt.validation?.warnings !== 0) throw new Error('Archify 收据摘要或 showcase 校验不匹配。');
    const receipt = { schema: 'reader-archify-delivery-v1', binding: projection.binding, input_sha256: projection.input_sha256,
      projector_sha256: digest(readFileSync(new URL('./semantic-reader-archify.mjs', import.meta.url))),
      archify_version: readFileSync(join(productRoot, '.agents/skills/archify/SKILL.md'), 'utf8').match(/version: \"([^\"]+)\"/)?.[1] ?? 'unknown',
      archify_cli_sha256: digest(readFileSync(archify)), specification: { path: 'diagram.archify.json', sha256: specHash, bytes: Buffer.byteLength(specBytes) },
      artifact: { path: 'diagram.html', sha256: artifactHash, bytes: bytes.length },
      counts: { nodes: projection.nodes.length, relations: projection.edges.length, evidence: Object.keys(projection.evidence).length, unknown: projection.unknowns.length },
      coverage: projection.coverage, unknowns: projection.unknowns, validation: toolReceipt.validation,
      browser_evidence: 'not_run', visual_review: 'not_run', application_executed: false };
    writeFileSync(join(staging, 'projection.json'), JSON.stringify(projection, null, 2) + '\n');
    writeFileSync(join(staging, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    // Retain Archify's exact diagnostic receipt separately; semantic receipt uses portable relative paths.
    writeFileSync(join(staging, 'archify-receipt.json'), JSON.stringify(toolReceipt, null, 2) + '\n');
    renameSync(staging, output);
    return { output, projection, receipt };
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true }); }
}
