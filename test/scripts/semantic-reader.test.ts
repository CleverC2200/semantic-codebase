import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-expect-error presentation renderer is a standalone JS script
import { buildReaderData } from '../../scripts/semantic-preview-explorer.mjs';

function fixture(source = '// 中文\nfunction hello() {}') {
  const bytes = Buffer.from(source);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { overlay: { snapshot_id:'snapshot', coverage:{status:'partial'}, facts:[], evidence:[{evidence_id:'e',file_path:'a.ts',source_digest:digest,span:{start_byte:Buffer.byteLength('// 中文\n'),end_byte:bytes.length}}] },
    manifest:{files:[{relative_path:'a.ts',source_digest:digest},{relative_path:'empty.ts',source_digest:createHash('sha256').update('').digest('hex')}]},
    sourceFiles:[{relative_path:'a.ts',source_bytes:bytes},{relative_path:'empty.ts',source_bytes:Buffer.from('')}],
    definitionsByKey:new Map([['f',{definition_key:'f',qualified_name:'hello',kind:'function',file_path:'a.ts',definition_span:{start_byte:Buffer.byteLength('// 中文\n'),end_byte:bytes.length}}]]) };
}
test('reader preserves manifest-only files and definitions with no semantic facts',()=>{
  const data=buildReaderData(fixture());
  assert.equal(data.files.length,2);
  assert.equal(data.files.find((f:{path:string})=>f.path==='empty.ts').source,'');
  assert.equal(data.definitions[0].line,2);
  assert.equal(data.evidence.e.line,2);
});
test('changed source cannot be shown as frozen snapshot evidence',()=>{
  const input=fixture();input.sourceFiles[0].source_bytes=Buffer.from('different source');
  const data=buildReaderData(input);
  assert.equal(data.files[0].verified,false);
  assert.equal(data.files[0].source,null);
  assert.equal(data.definitions[0].line,null);
  assert.equal(data.evidence.e.line,null);
});
test('missing local source keeps directory identity and explicit unavailable content',()=>{
  const input=fixture();input.sourceFiles=[];
  const data=buildReaderData(input);
  assert.equal(data.files[0].path,'a.ts');assert.equal(data.files[0].source,null);
  assert.equal(data.definitions.length,1);
});

// @ts-expect-error standalone presentation module
import { callableSignature } from '../../scripts/semantic-reader-signature.mjs';
test('callable signature separates callbacks, object parameters and type predicates',()=>{
  const signature=callableSignature('<T>(x: Map<string, T>, check: (arg: T) => boolean, options?: { keys: string[]; pair: [number, string] }) => x is Map<string, T>');
  assert.equal(signature.inputs.length,3);
  assert.equal(signature.inputs[1].type,'(arg: T) => boolean');
  assert.equal(signature.inputs[2].optional,true);
  assert.equal(signature.output,'x is Map<string, T>');
  assert.equal(callableSignature('() => void').inputs.length,0);
});
test('unsupported overloaded or truncated types are not guessed into a parameter contract',()=>{
  assert.equal(callableSignature('{ (x: string): boolean; (x: number): boolean; }'),null);
  assert.equal(callableSignature('(x: Map<string, ...'),null);
});
