import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { prepareOaArchifyRenderer } from '../../scripts/prepare-oa-archify-renderer.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../scripts/archify-oa-desktop/manifest.json', import.meta.url), 'utf8'));
const installed = resolve(process.env.ARCHIFY_TEST_ROOT || '.agents/skills/archify');
const installedAvailable = existsSync(join(installed, 'bin/archify.mjs'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'oa-archify-profile-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'installed');
  mkdirSync(source);
  return { root, source, output: join(root, 'renderer') };
}

test('existing output and broken symlink are not replaced', t => {
  const { root, source, output } = workspace(t);
  mkdirSync(output); writeFileSync(join(output, 'trusted.html'), 'previous artifact');
  assert.throws(() => prepareOaArchifyRenderer(source, output), /已存在/);
  assert.equal(readFileSync(join(output, 'trusted.html'), 'utf8'), 'previous artifact');
  const link = join(root, 'broken'); symlinkSync(join(root, 'missing'), link);
  assert.throws(() => prepareOaArchifyRenderer(source, link), /已存在/);
});

test('output cannot be created inside the installation, including through a parent symlink', t => {
  const { root, source } = workspace(t);
  assert.throws(() => prepareOaArchifyRenderer(source, join(source, 'renderer')), /安装目录之外/);
  const alias = join(root, 'alias'); symlinkSync(source, alias);
  assert.throws(() => prepareOaArchifyRenderer(source, join(alias, 'renderer')), /安装目录之外/);
  assert.ok(!existsSync(join(source, 'renderer')));
});

test('mismatched baseline fails before creating output', t => {
  const { source, output } = workspace(t), file = join(source, manifest.files[0].path);
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'another Archify version');
  assert.throws(() => prepareOaArchifyRenderer(source, output), /基线不匹配/);
  assert.ok(!existsSync(output));
  assert.equal(readFileSync(file, 'utf8'), 'another Archify version');
});

test('symlinked runtime input is rejected before reading unlisted files', t => {
  const { root, source, output } = workspace(t), file = join(source, manifest.files[0].path);
  mkdirSync(dirname(file), { recursive: true });
  const outside = join(root, 'outside'); writeFileSync(outside, 'unlisted data'); symlinkSync(outside, file);
  assert.throws(() => prepareOaArchifyRenderer(source, output), /普通文件/);
  assert.ok(!existsSync(output));
});

test('pinned real renderer reproduces reviewed source bytes without copying local settings', { skip: !installedAvailable }, t => {
  const { source, output } = workspace(t);
  for (const file of manifest.files) {
    const target = join(source, file.path);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(join(installed, file.path)));
  }
  writeFileSync(join(source, '.env'), 'fixture-only-not-a-secret');
  mkdirSync(join(source, '.codex')); writeFileSync(join(source, '.codex/config.toml'), '# not runtime');
  const receipt = prepareOaArchifyRenderer(source, output);
  assert.equal(receipt.installed_tool_modified, false);
  assert.equal(receipt.application_executed, false);
  for (const file of manifest.files) {
    assert.equal(digest(readFileSync(join(source, file.path))), file.base_sha256, 'source: ' + file.path);
    assert.equal(digest(readFileSync(join(output, file.path))), file.patched_sha256, 'output: ' + file.path);
  }
  assert.ok(!existsSync(join(output, '.env')));
  assert.ok(!existsSync(join(output, '.codex')));
  assert.deepEqual(JSON.parse(readFileSync(join(output, 'desktop-profile-receipt.json'), 'utf8')).files, manifest.files);
});
