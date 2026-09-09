import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { archifyFixture } from '../fixtures/reader-archify/fixture.mjs';
import { deliverReaderArchify, readArchifyReader } from '../../scripts/semantic-reader-archify-delivery.mjs';
import { serveReaderArchify } from '../../scripts/serve-reader-archify.mjs';

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'reader-archify-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('remote', 'add', 'origin', 'https://github.com/example/repo');
  const data = archifyFixture(); mkdirSync(join(root, 'src')); writeFileSync(join(root, data.files[0].path), data.files[0].source);
  git('add', 'src'); git('-c', 'user.name=Reader Test', '-c', 'user.email=reader@example.test', 'commit', '-qm', 'fixture');
  data.revision = git('rev-parse', 'HEAD');
  return { root, data };
}
const archifyInstalled = existsSync('.agents/skills/archify/bin/archify.mjs');

test('existing delivery is never overwritten', async t => {
  const { root, data } = repository(t), output = join(root, 'delivery');
  mkdirSync(output); writeFileSync(join(output, 'diagram.html'), 'trusted');
  await assert.rejects(deliverReaderArchify(data, 'flow', output, root), /已存在/);
  assert.equal(readFileSync(join(output, 'diagram.html'), 'utf8'), 'trusted');
});

test('revision content mismatch fails even when manifest digests agree with input bytes', async t => {
  const { root, data } = repository(t);
  data.files[0].source += '// altered';
  const hash = createHash('sha256').update(data.files[0].source).digest('hex');
  data.files[0].source_digest = hash;
  Object.values(data.evidence).forEach(e => { e.source_digest = hash; });
  data.mainlines[0].source_digests[data.files[0].path] = hash;
  data.mainlines[0].stages[0].refs.forEach(r => { r.source_digest = hash; });
  await assert.rejects(deliverReaderArchify(data, 'flow', join(root, 'delivery'), root), /Git revision 内容不一致/);
  assert.ok(!existsSync(join(root, 'delivery')));
});

test('renderer failure cannot publish an artifact or receipt', { skip: !archifyInstalled }, async t => {
  const { root, data } = repository(t), output = join(root, 'delivery');
  await assert.rejects(deliverReaderArchify(data, 'flow', output, root, { runner: () => ({ status: 1, stdout: JSON.stringify({ ok: false, error: 'bad geometry' }) }) }), /bad geometry/);
  assert.ok(!existsSync(output));
});

test('delivery binds real Git source, projection and exact artifact bytes, then serves one-click generation', { skip: !archifyInstalled }, async t => {
  const { root, data } = repository(t), output = join(root, 'delivery');
  const result = await deliverReaderArchify(data, 'flow', output, root);
  const receipt = JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8'));
  assert.equal(receipt.binding.snapshot, data.snapshot);
  assert.equal(receipt.binding.revision, data.revision);
  assert.equal(receipt.validation.checksPassed, 9);
  assert.equal(receipt.artifact.sha256, createHash('sha256').update(readFileSync(join(output, 'diagram.html'))).digest('hex'));
  assert.equal(receipt.specification.sha256, createHash('sha256').update(readFileSync(join(output, 'diagram.archify.json'))).digest('hex'));
  assert.equal(receipt.input_sha256, result.projection.input_sha256);
  const { server, url } = await serveReaderArchify(data, root, { outputDirectory: join(root, 'server') });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const page = await (await fetch(url)).text();
  const bootstrap = JSON.parse(page.match(/<script id="reader-data" type="application\/json">([^<]+)<\/script>/)[1]);
  assert.equal(bootstrap.facts.length, 0); assert.equal(Object.keys(bootstrap.evidence).length, 0);
  assert.equal(bootstrap.files[0].source, null);
  const headers = { 'Content-Type': 'application/json', 'X-Reader-Token': bootstrap.archifyService.token };
  assert.equal((await fetch(url + '/archify/generate', { method: 'POST', headers, body: JSON.stringify({ mainline: 'flow' }), })).status, 200);
  const response = await fetch(url + '/archify/generate', { method: 'POST', headers, body: JSON.stringify({ mainline: 'flow' }) });
  const body = await response.json();
  const artifact = await (await fetch(url + body.artifactUrl)).text();
  assert.equal(createHash('sha256').update(artifact).digest('hex'), body.receipt.artifact.sha256);
  assert.equal((await fetch(url + '/archify/generate', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example' }, body: JSON.stringify({ mainline: 'flow' }) })).status, 403);
  assert.equal((await fetch(url + '/archify/generate', { method: 'POST', headers, body: JSON.stringify({ mainline: 'flow', source: 'not accepted' }) })).status, 400);
  assert.equal((await fetch(url + '/archify/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mainline: 'flow' }) })).status, 403);
});


test('legacy source identity requires exact adjacent receipt binding and never uses current HEAD', async t => {
  const { root, data } = repository(t), file = join(root, 'reader-data.json');
  const old = { ...data, revision: null, repositoryUrl: null };
  writeFileSync(file, JSON.stringify(old));
  assert.equal(readArchifyReader(file).revision, null);
  const receipt = { snapshot_id: data.snapshot, overlay_hash: data.overlayHash, source_head: data.revision, files: data.files.map(f => ({ relative_path: f.path, source_digest: f.source_digest })) };
  writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt));
  assert.equal(readArchifyReader(file).revision, data.revision);
  writeFileSync(join(root, 'receipt.json'), JSON.stringify({ ...receipt, snapshot_id: 'different' }));
  assert.throws(() => readArchifyReader(file), /不一致/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).revision, null);
});
