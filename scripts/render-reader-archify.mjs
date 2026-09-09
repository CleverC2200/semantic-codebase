#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [specPath, outputPath] = process.argv.slice(2);
if (!specPath || !outputPath) { console.error('用法：node scripts/render-reader-archify.mjs <spec.json> <output.html>'); process.exit(2); }
const spec = JSON.parse(readFileSync(resolve(specPath), 'utf8'));
if (spec.schema_version !== 1 || spec.diagram_type !== 'architecture' || !Array.isArray(spec.components) || !Array.isArray(spec.connections)) throw new Error('只接受 schema_version=1 的 Archify architecture 规格。');
if (!/^[a-f0-9]{40}$/i.test(spec.meta?.repository?.revision ?? '')) throw new Error('规格缺少 40 位 Git revision。');
const archify = resolve('.agents/skills/archify/bin/archify.mjs');
if (!existsSync(archify)) throw new Error('项目级 Archify 未安装，请先安装 .agents/skills/archify。');
const result = spawnSync(process.execPath, [archify, 'deliver', spec.diagram_type, resolve(specPath), resolve(outputPath), '--repo-root', process.cwd(), '--quality', 'showcase', '--json'], { encoding: 'utf8' });
if (result.stdout) { process.stdout.write(result.stdout); if (result.status === 0) writeFileSync(`${resolve(outputPath)}.receipt.json`, result.stdout); }
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
