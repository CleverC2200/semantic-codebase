#!/usr/bin/env node
import { deliverReaderArchify, readArchifyReader } from './semantic-reader-archify-delivery.mjs';

const [readerPath, mainlineId, outputDirectory, sourceRoot] = process.argv.slice(2);
if (!readerPath || !mainlineId || !outputDirectory || !sourceRoot) {
  console.error('用法：node scripts/render-reader-archify.mjs <reader-data.json> <mainline-id> <新交付目录> <源码Git根目录>');
  process.exitCode = 2;
} else {
  try {
    const data = readArchifyReader(readerPath);
    if (data.schema !== 'reader-snapshot-v1' || data.assetManifest) throw new Error('需要完整冻结 reader-data.json；Archify 规格本身不能证明 Evidence Closure。');
    const result = await deliverReaderArchify(data, mainlineId, outputDirectory, sourceRoot);
    console.log(JSON.stringify({ output: result.output, ...result.receipt }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
