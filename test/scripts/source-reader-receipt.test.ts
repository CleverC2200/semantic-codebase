import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const runner = fileURLToPath(new URL('../../scripts/run-source-reader.mjs', import.meta.url));

test('source reader never attributes parent Git identity to a directory snapshot', () => {
  const root=mkdtempSync(path.join(tmpdir(),'source-receipt-'));
  const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init','-q');writeFileSync(path.join(root,'anchor'),'parent');git('add','anchor');git('-c','user.name=Receipt Test','-c','user.email=receipt@example.invalid','commit','-qm','parent');
    const sample=path.join(root,'sample');mkdirSync(sample);writeFileSync(path.join(sample,'sample.ts'),'export function answer() { return 42; }');
    const manifest=path.join(root,'files.json');writeFileSync(manifest,'["sample.ts"]');
    const output=path.join(root,'output');execFileSync(process.execPath,[runner,sample,manifest,output],{stdio:'pipe'});
    const receipt=JSON.parse(readFileSync(path.join(output,'receipt.json'),'utf8'));
    assert.equal(receipt.source_head,null);assert.equal(receipt.source_status,null);
    assert.equal(receipt.source_kind,'directory_snapshot');assert.equal(receipt.source_git_reason,'enclosing_repository');
    assert.equal(receipt.files.length,1);assert.match(receipt.manifest_hash,/^[a-f0-9]{64}$/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('source reader supports non-Git directories and records an actual source Git root', () => {
 const root=mkdtempSync(path.join(tmpdir(),'source-root-'));
 try {
  const sample=path.join(root,'sample');mkdirSync(sample);writeFileSync(path.join(sample,'sample.ts'),'export const answer = 42;');
  const manifest=path.join(root,'files.json');writeFileSync(manifest,'["sample.ts"]');
  const run=(name:string)=>{const output=path.join(root,name);execFileSync(process.execPath,[runner,sample,manifest,output],{stdio:'pipe'});return JSON.parse(readFileSync(path.join(output,'receipt.json'),'utf8'));};
  assert.equal(run('no-git').source_git_reason,'git_unavailable');
  const git=(...args:string[])=>execFileSync('git',['-C',sample,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('add','sample.ts');git('-c','user.name=Receipt Test','-c','user.email=receipt@example.invalid','commit','-qm','source');
  const r=run('with-git');assert.equal(r.source_kind,'git_root');assert.equal(r.source_head,git('rev-parse','HEAD'));assert.equal(r.source_status,'');
 } finally {rmSync(root,{recursive:true,force:true});}
});
