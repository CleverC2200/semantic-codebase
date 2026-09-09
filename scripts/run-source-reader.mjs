import { readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepositoryIndexer, PythonTreeSitterAdapter, PythonPyrightEnricher, TypeScriptTreeSitterAdapter, TypeScriptSemanticEnricher, SqliteSnapshotStore, sha256Bytes, canonicalHash } from '../dist/index.js';
import { renderSemanticPreview, buildReaderData } from './semantic-preview-explorer.mjs';

// Explicit file allowlist: never traverse a repository or load its runtime/configuration.
const [repoArg, manifestArg, outputArg, presentationArg] = process.argv.slice(2);
if (!repoArg || !manifestArg || !outputArg) throw new Error('Usage: node scripts/run-source-reader.mjs REPO FILE_LIST_JSON NEW_OUTPUT [PRESENTATION_JSON]');
const repo = realpathSync(repoArg), output = path.resolve(outputArg);
if (existsSync(output)) throw new Error('Output already exists; use a new snapshot directory');
const names = JSON.parse(readFileSync(manifestArg, 'utf8'));
if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length) throw new Error('Expected nonempty unique file list');
const files = names.sort().map(relative_path => {
  if (typeof relative_path !== 'string' || !/^[\w./-]+\.(?:py|ts|tsx)$/.test(relative_path) || relative_path.split('/').some(p => !p || p === '.' || p === '..') || path.isAbsolute(relative_path)) throw new Error('Invalid source path');
  const target = path.join(repo, relative_path);
  if (!lstatSync(target).isFile() || realpathSync(target) !== target) throw new Error('Source must be a regular file without symlinks');
  const source_bytes = readFileSync(target);
  return { relative_path, language: relative_path.endsWith('.py') ? 'python' : 'typescript', source_bytes, source_digest: sha256Bytes(source_bytes) };
});
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
// Git walks upward: only an exact source root may claim a repository HEAD.
let sourceIdentity = { source_kind:'directory_snapshot', source_head:null, source_status:null, source_git_reason:'git_unavailable' };
try {
  if (realpathSync(git('rev-parse','--show-toplevel')) === repo) {
    sourceIdentity = { source_kind:'git_root', source_head:git('rev-parse','HEAD'), source_status:git('status','--porcelain'), source_git_reason:null };
  } else sourceIdentity.source_git_reason = 'enclosing_repository';
} catch { /* Directory snapshots remain identified by their content manifest. */ }
const source = { repository_id: path.basename(repo) + '-source-reader', files };
const started = performance.now();
if (new Set(files.map(f=>f.language)).size!==1) throw new Error('Select one language per analysis manifest');
const python = files[0].language === 'python';
const state = new RepositoryIndexer({ adapters: [python ? new PythonTreeSitterAdapter() : new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
const overlay = (python ? new PythonPyrightEnricher() : new TypeScriptSemanticEnricher()).enrich({ state, source });
const reader = presentationArg ? JSON.parse(readFileSync(presentationArg,'utf8')) : {};
reader.project ??= path.basename(repo); reader.sourceRoot ??= ''; reader.explanations ??= { files:{} }; reader.capabilities ??= []; reader.mainlines ??= [];
const productRoot = fileURLToPath(new URL('../', import.meta.url));
const toolFiles = directory => readdirSync(path.join(productRoot,directory),{withFileTypes:true}).flatMap(e=>e.isDirectory()?toolFiles(directory+'/'+e.name):e.isFile()?[directory+'/'+e.name]:[]);
const productFiles = [...toolFiles('dist'),...toolFiles('scripts'),'package-lock.json'].sort();
const receipt = {
  schema_version: 1, generated_at: new Date().toISOString(), source_root: repo,
  ...sourceIdentity,
  snapshot_id: state.snapshot_id, overlay_hash: overlay.overlay_hash,
  files: files.map(({relative_path,source_digest})=>({relative_path,source_digest})),
  manifest_hash: canonicalHash(files.map(({relative_path,source_digest})=>({relative_path,source_digest}))),
  product_head: execFileSync('git',['-C',productRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  product_sources_hash: canonicalHash(productFiles.map(p=>({path:p,sha256:sha256Bytes(readFileSync(path.join(productRoot,p)))}))),
  generator_sha256: sha256Bytes(readFileSync(fileURLToPath(import.meta.url))),
  presentation_hash: canonicalHash(reader), node:process.version, profile:overlay.profile,
  counts:{files:files.length,definitions:state.graph.definitions.length,facts:overlay.facts.length,evidence:overlay.evidence.length},
  coverage:overlay.coverage, diagnostic_codes:[...new Set(overlay.diagnostics.map(d=>d.code))],
  analysis_ms:Math.round(performance.now()-started), application_executed:false, model_invoked:false,
  boundary:'Only allowlisted source files; no repository configuration, installed environment, runtime data or external service. Explanations and mainlines are unverified presentation candidates.',
};
// Recheck bytes before publishing so the receipt never labels a changed checkout as frozen input.
for (const file of files) if (sha256Bytes(readFileSync(path.join(repo,file.relative_path))) !== file.source_digest) throw new Error('Source changed during analysis');
mkdirSync(output,{recursive:true,mode:0o700});
const store = new SqliteSnapshotStore(path.join(output,'preview.sqlite'));
try { store.beginBuild(state.repository_id,state.snapshot_id);store.publishReady(state);store.publishSemanticOverlay(overlay); } finally { store.close(); }
const input={overlay,reader,receipt,revision:receipt.source_head ?? null,definitionsByKey:new Map(state.graph.definitions.map(d=>[d.definition_key,d])),sourceFiles:files,manifest:state.manifest,structuralGraph:state.graph};
for (const [name,value] of Object.entries({'receipt.json':receipt,'semantic-overlay.json':overlay,'reader-data.json':buildReaderData(input),'presentation.json':reader})) writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
writeFileSync(path.join(output,'acceptance.html'),renderSemanticPreview(input));
console.log(JSON.stringify({output,...receipt.counts,coverage:overlay.coverage.status,analysis_ms:receipt.analysis_ms}));
