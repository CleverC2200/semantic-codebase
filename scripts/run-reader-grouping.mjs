import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { groupReaderData } from './semantic-reader-grouping.mjs';
import { renderReaderData } from './semantic-preview-explorer.mjs';

const [input, directory, ...flags] = process.argv.slice(2);
if (!input || !directory) throw new Error('Usage: node scripts/run-reader-grouping.mjs READER_JSON NEW_OUTPUT [--max-definitions=N --max-links=N --max-proposals=N]');
const limits = {};
for (const flag of flags) {
  const match = /^--(max-definitions|max-links|max-proposals)=(\d+)$/.exec(flag);
  if (!match) throw new Error('Invalid grouping option: ' + flag);
  limits[{ 'max-definitions': 'maxDefinitions', 'max-links': 'maxLinks', 'max-proposals': 'maxProposals' }[match[1]]] = Number(match[2]);
}
const output = path.resolve(directory);
if (existsSync(output)) throw new Error('Output already exists; choose a new directory');
const bytes = readFileSync(input), data = JSON.parse(bytes.toString('utf8'));
const started = performance.now();
const result = groupReaderData(data, limits);
const receipt = { generated_at: new Date().toISOString(), snapshot: data.snapshot, overlay: data.overlayHash,
  input_sha256: createHash('sha256').update(bytes).digest('hex'), strategy: result.grouping.strategy,
  node:process.version, generator_sha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), grouping_sha256:createHash('sha256').update(readFileSync(new URL('./semantic-reader-grouping.mjs',import.meta.url))).digest('hex'), manual_mapping_count:result.grouping.manual_mapping_count, status:result.grouping.status, unknown_links:result.grouping.unknown_links.length, truncated_links:result.grouping.truncated_links, truncated_proposals:result.grouping.truncated_proposals, limits: result.grouping.limits, coverage: result.grouping.coverage, analysis_reused: true,
  grouping_ms: Math.round(performance.now() - started), application_executed: false, model_invoked: false };
const html = renderReaderData(result, receipt);
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const [name, value] of Object.entries({ 'reader-data.json': result, 'receipt.json': receipt })) writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
writeFileSync(path.join(output, 'acceptance.html'), html);
console.log(JSON.stringify({ output, ...receipt }));
