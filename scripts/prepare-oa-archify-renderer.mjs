#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const profileRoot = fileURLToPath(new URL('./archify-oa-desktop/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = path => {
  try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

// The profile is deliberately opt-in. Installed tools and existing artifacts stay immutable.
// Copy only hash-pinned runtime files, never installation-local settings or research inputs.
export function prepareOaArchifyRenderer(installedRoot, outputDirectory) {
  const source = realpathSync(installedRoot), output = resolve(outputDirectory);
  if (exists(output)) throw new Error('输出目录已存在；请使用新目录。');
  const parent = realpathSync(dirname(output));
  const withinSource = relative(source, parent);
  if (withinSource === '' || (!withinSource.startsWith('..' + sep) && withinSource !== '..' && !isAbsolute(withinSource))) {
    throw new Error('输出目录必须位于安装目录之外。');
  }
  const manifest = JSON.parse(readFileSync(join(profileRoot, 'manifest.json'), 'utf8'));
  const patchPath = join(profileRoot, 'renderer.patch');
  if (digest(readFileSync(patchPath)) !== manifest.patch_sha256) throw new Error('桌面配置补丁摘要不匹配。');
  const inputs = manifest.files.map(file => {
    if (isAbsolute(file.path) || file.path.split(/[\\/]/).some(part => ['', '.', '..'].includes(part))) throw new Error('无效的配置文件路径。');
    const input = join(source, file.path);
    if (!lstatSync(input).isFile() || realpathSync(input) !== input) throw new Error('运行文件必须是普通文件：' + file.path);
    const bytes = readFileSync(input);
    if (digest(bytes) !== file.base_sha256) throw new Error('Archify 基线不匹配：' + file.path + '；需要本配置绑定的 2.17 文件。');
    return { ...file, bytes };
  });
  const staging = mkdtempSync(join(parent, '.oa-archify-renderer-'));
  try {
    for (const file of inputs) {
      const target = join(staging, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes);
    }
    // Preserve the reviewed renderer bytes, including upstream whitespace; hashes verify the result.
    execFileSync('git', ['apply', '--no-index', '--whitespace=nowarn', patchPath], { cwd: staging, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const file of inputs) {
      if (digest(readFileSync(join(staging, file.path))) !== file.patched_sha256) throw new Error('桌面配置结果摘要不匹配：' + file.path);
    }
    const receipt = { schema: 'oa-archify-renderer-receipt-v1', profile_sha256: digest(readFileSync(join(profileRoot, 'manifest.json'))),
      patch_sha256: manifest.patch_sha256, files: manifest.files, installed_tool_modified: false, application_executed: false };
    writeFileSync(join(staging, 'desktop-profile-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    if (exists(output)) throw new Error('输出目录已存在；已有内容保持不变。');
    renameSync(staging, output);
    return { output, ...receipt };
  } finally { if (exists(staging)) rmSync(staging, { recursive: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error('用法：node scripts/prepare-oa-archify-renderer.mjs <已安装Archify目录> <新renderer目录，父目录须存在>');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(prepareOaArchifyRenderer(...args), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
