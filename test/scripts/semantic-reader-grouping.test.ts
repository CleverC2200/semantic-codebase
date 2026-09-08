import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// @ts-expect-error standalone reader projection
import { groupReaderData } from '../../scripts/semantic-reader-grouping.mjs';
// @ts-expect-error standalone reader projection
import { createReaderCapabilityModel } from '../../scripts/semantic-reader-capabilities.mjs';

function fixture() {
  const specs = [
    ['src/orders/order.ts', ['createOrder', 'saveOrder', '_normalize']],
    ['src/shared/cache.ts', ['readCache', 'writeCache']],
    ['src/report.ts', ['renderReport']],
  ] as const;
  const files: any[] = [], definitions: any[] = [], evidence: Record<string, any> = {};
  for (const [path, names] of specs) {
    const source = names.map(n => `function ${n}() {}`).join('\n');
    const source_digest = createHash('sha256').update(source).digest('hex');
    files.push({ path, source, source_digest, verified: true });
    let start = 0;
    for (const [i, name] of names.entries()) {
      const span = { start_byte: start, end_byte: start + `function ${name}() {}`.length };
      const key = path + ':' + name, id = 'e:' + key;
      definitions.push({ definition_key: key, name, qualified_name: name, snapshot_id: 's1', file_path: path, kind: 'function', definition_span: span, line: i + 1, endLine: i + 1, evidence_ids: [id] });
      evidence[id] = { evidence_id: id, file_path: path, span, snapshot_id: 's1', source_digest, line: i + 1 };
      start = span.end_byte + 1;
    }
  }
  return { schema: 'reader-snapshot-v1', repository: 'unconfigured', snapshot: 's1', overlayHash: 'o1', files, definitions, evidence, facts: [] as any[], relations: [] as any[], mainlines: [], capabilityCandidates: [], coverage: { status: 'partial' } };
}

test('unconfigured frozen input produces readable structural modules without losing isolated or auxiliary definitions', () => {
  const input = fixture(), before = JSON.stringify(input);
  const result = groupReaderData(input), model = createReaderCapabilityModel(result);
  const modules = result.capabilityCandidates.filter((c: any) => c.category === 'structural_module');
  assert.equal(modules.length, 3);
  assert.equal(modules.find((c: any) => c.file_path === 'src/orders/order.ts').definitions.length, 3);
  assert.deepEqual(model.unassigned(), []);
  assert.equal(result.grouping.coverage.structural.mapped, 6);
  assert.equal(result.grouping.coverage.business.status, 'unknown');
  assert.equal(JSON.stringify(input), before, 'frozen analysis is not changed');
  const reordered = { ...input, files: [...input.files].reverse(), definitions: [...input.definitions].reverse() };
  assert.deepEqual(groupReaderData(reordered).capabilityCandidates, result.capabilityCandidates);
});

test('source, Definition and Evidence version failures remain unassigned with an inspectable reason', () => {
  const input = fixture();
  input.definitions[0].snapshot_id = 'old';
  input.evidence[input.definitions[1].evidence_ids[0]].source_digest = 'wrong';
  input.files[1].source = 'changed';
  const result = groupReaderData(input), m = createReaderCapabilityModel(result);
  assert.equal(m.unassigned().length, 4);
  assert.deepEqual(result.grouping.unassigned.map((x: any)=>x.reason).sort(), ['definition_evidence_unavailable', 'definition_version_mismatch', 'source_unavailable_or_changed', 'source_unavailable_or_changed'].sort());
  assert.equal(result.capabilityCandidates.find((c:any)=>c.file_path==='src/orders/order.ts').definitions.length, 1);
});

test('module navigation uses directory levels without treating a directory as a business capability', () => {
  const result = groupReaderData(fixture()), m = createReaderCapabilityModel(result);
  const file = result.capabilityCandidates.find((c:any)=>c.file_path==='src/orders/order.ts');
  assert.equal(m.get(file.parent).category, 'structural_directory');
  assert.equal(m.get(file.parent).title, 'orders');
  assert.equal(m.ancestors(file.id).at(-2).title, 'src');
  assert.equal(file.title, 'order.ts');
});

function call(input: ReturnType<typeof fixture>, from: number, to: number | null, name: string) {
  const source = input.definitions[from], target = to === null ? null : input.definitions[to];
  input.facts.push({ fact_id: name, kind: 'call_target', snapshot_id: input.snapshot, subject: {kind:'definition',definition_key:source.definition_key}, value:{call:name,target_definition_key:target?.definition_key ?? null,call_site_evidence_id:source.evidence_ids[0]}, basis:{kind:'static_possible'}, evidence_ids:source.evidence_ids });
}
test('shared implementation has one owner, traceable cross-directory uses, and unresolved calls stay unknown', () => {
  const input=fixture(); call(input,0,3,'readCache'); call(input,5,3,'readCacheFromReport'); call(input,3,3,'recursive'); call(input,0,null,'dynamic');
  const result=groupReaderData(input), modules=result.capabilityCandidates.filter((c:any)=>c.category==='structural_module');
  const orders=modules.find((c:any)=>c.file_path==='src/orders/order.ts'), cache=modules.find((c:any)=>c.file_path==='src/shared/cache.ts'), report=modules.find((c:any)=>c.file_path==='src/report.ts');
  assert.deepEqual(orders.uses,[cache.id]); assert.deepEqual(report.uses,[cache.id]); assert.deepEqual(cache.uses,[]);
  assert.equal(modules.filter((c:any)=>c.definitions.includes(input.definitions[3].definition_key)).length,1);
  assert.equal(result.grouping.links.length,3);
  assert.equal(result.grouping.unknown_links[0].reason,'unresolved_call_target');
  assert.equal(result.grouping.links[0].basis,'static_possible');
});

test('frozen resolved imports add uses while stale or foreign Evidence does not', () => {
  const input=fixture();
  const source=input.files[0], target=input.files[1];
  input.relations.push({relation_id:'import',kind:'IMPORTS',snapshot_id:'s1',source:{kind:'source_file',file_path:source.path},target:{kind:'source_file',file_path:target.path},evidence_ids:input.definitions[0].evidence_ids});
  const result=groupReaderData(input);
  assert.equal(result.grouping.links[0].kind,'import');
  input.relations[0].snapshot_id='old';
  assert.equal(groupReaderData(input).grouping.links.length,0);
  input.relations[0].snapshot_id='s1';input.relations[0].evidence_ids=input.definitions[3].evidence_ids;
  assert.equal(groupReaderData(input).grouping.links.length,0);
});

test('business and support suggestions require independent naming, path and connected Definition evidence', () => {
  const input=fixture();
  assert.equal(groupReaderData(input).capabilityCandidates.filter((c:any)=>c.category?.endsWith('_candidate')).length,0,'names alone cannot invent a responsibility');
  call(input,0,1,'saveOrder'); call(input,3,4,'writeCache'); call(input,5,0,'unrelatedCaller');
  const result=groupReaderData(input), proposals=result.capabilityCandidates.filter((c:any)=>c.category?.endsWith('_candidate'));
  assert.equal(proposals.length,2);
  const order=proposals.find((c:any)=>c.category==='business_candidate'), cache=proposals.find((c:any)=>c.category==='support_candidate');
  assert.match(order.title,/order/i);assert.match(cache.title,/cache/i);
  assert.deepEqual(order.suggested_definitions,[input.definitions[0].definition_key,input.definitions[1].definition_key].sort());
  assert.equal(order.suggested_definitions.includes(input.definitions[5].definition_key),false,'one call does not merge the unrelated report');
  assert.equal(order.basis,'framework_heuristic'); assert.equal(order.verified,false);
  assert.equal(result.grouping.coverage.business.status,'partial');
});

test('only version-bound existing Application Flow references are attached to automatic suggestions', () => {
  const input=fixture(); call(input,0,1,'saveOrder');
  const d=input.definitions[0], f=input.files[0];
  (input.mainlines as any[]).push({id:'orders',title:'Order flow',available:true,snapshot:'s1',source_digests:{[f.path]:f.source_digest},stages:[{id:'create',keys:[d.definition_key],refs:[{definition_key:d.definition_key,file:f.path,source_digest:f.source_digest,snapshot:'s1',startLine:1,endLine:1,excerpt:'function createOrder() {}'}]}],edges:[]});
  const result=groupReaderData(input);
  assert.deepEqual(result.capabilityCandidates.find((c:any)=>c.category==='business_candidate').mainlines,['orders']);
  (input.mainlines as any[])[0].stages[0].keys.push(input.definitions[5].definition_key);
  assert.equal(groupReaderData(input).mainlines[0].available,false,'stage keys must match validated refs');
  (input.mainlines as any[])[0].stages[0].keys.pop();
  (input.mainlines as any[])[0].stages[0].refs[0].snapshot='old';
  assert.deepEqual(groupReaderData(input).capabilityCandidates.find((c:any)=>c.category==='business_candidate').mainlines,[]);
});

test('automatic regeneration preserves decisions but strategy and evidence changes require review', () => {
  const input=fixture(); call(input,0,1,'saveOrder');const result=groupReaderData(input);
  let raw: string|null=null;const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;}};
  let m=createReaderCapabilityModel(result,{storage});const candidate=result.capabilityCandidates.find((c:any)=>c.category==='business_candidate');
  m.decide({id:candidate.id,action:'confirm',parent:candidate.parent,actor:'reader',reason:'核对职责',expected_version:0});
  assert.equal(createReaderCapabilityModel(groupReaderData(input),{storage}).get(candidate.id).status,'confirmed');
  const revised=structuredClone(result);revised.capabilityCandidates.find((c:any)=>c.id===candidate.id).strategy='reader-groups-v2';
  m=createReaderCapabilityModel(revised,{storage});assert.equal(m.get(candidate.id).status,'needs_review');assert.equal(m.history(candidate.id).length,1);
  m.decide({id:candidate.id,action:'revoke',parent:null,actor:'reader',reason:'重新核对',expected_version:1});
  assert.equal(createReaderCapabilityModel(revised,{storage}).get(candidate.id).status,'candidate');
});

test('removed candidates retain visible decision history without assigning a same-name replacement', () => {
  const input=fixture(), result=groupReaderData(input);let raw:string|null=null;
  const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;}};
  const candidate=result.capabilityCandidates.find((c:any)=>c.file_path==='src/report.ts');
  createReaderCapabilityModel(result,{storage}).decide({id:candidate.id,action:'confirm',parent:candidate.parent,actor:'reader',reason:'checked',expected_version:0});
  const without={...result,capabilityCandidates:result.capabilityCandidates.filter((c:any)=>c.id!==candidate.id)};
  const m=createReaderCapabilityModel(without,{storage});
  assert.equal(m.orphanedHistory()[0].id,candidate.id);assert.equal(m.unassigned().includes(input.definitions[5].definition_key),true);
});

test('budget-limited generation returns a readable partial package without silently dropping Definitions', () => {
  const input=fixture();call(input,0,1,'saveOrder');call(input,3,4,'writeCache');
  const limited=groupReaderData(input,{maxDefinitions:2,maxLinks:1,maxProposals:0});
  assert.equal(limited.grouping.coverage.structural.status,'partial');
  assert.equal(limited.grouping.coverage.structural.mapped,2);
  assert.equal(limited.grouping.unassigned.filter((x:any)=>x.reason==='definition_budget_exceeded').length,4);
  assert.equal(limited.grouping.truncated_links,1);
  assert.equal(limited.definitions.length,6);
  assert.equal(limited.grouping.limits.maxDefinitions,2);
  assert.equal(createReaderCapabilityModel(limited).unassigned().length,4);
  const noProposals=groupReaderData(input,{maxProposals:0});
  assert.equal(noProposals.grouping.truncated_proposals,2);
  assert.equal(noProposals.grouping.status,'partial');
  assert.throws(()=>groupReaderData(input,{maxDefinitions:-1}),/LIMIT/);
});

test('rejects malformed and duplicate frozen identities instead of overwriting owners', () => {
  for (const field of ['files','definitions','facts']) assert.throws(()=>groupReaderData({...fixture(),[field]:null}),/GROUPING_INVALID_INPUT/);
  const input=fixture(); input.definitions.push({...input.definitions[0]});
  assert.throws(()=>groupReaderData(input),/GROUPING_DUPLICATE_IDENTITY/);
  const files=fixture(); files.files.push({...files.files[0]});
  assert.throws(()=>groupReaderData(files),/GROUPING_DUPLICATE_IDENTITY/);
});

test('a removed manually selected parent requires review instead of breaking regeneration', () => {
 const input=fixture(), result=groupReaderData(input);let raw:string|null=null; const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;}};
 const files=result.capabilityCandidates.filter((c:any)=>c.category==='structural_module');
 createReaderCapabilityModel(result,{storage}).decide({id:files[0].id,parent:files[1].id,action:'confirm',actor:'reader',reason:'adjust',expected_version:0});
 const next={...result,capabilityCandidates:result.capabilityCandidates.filter((c:any)=>c.id!==files[1].id)};
 assert.equal(createReaderCapabilityModel(next,{storage}).get(files[0].id).status,'needs_review');
});

test('large frozen input retains every over-budget identity with bounded generation', () => {
 const input=fixture();const sample=structuredClone(input);input.files=[];input.definitions=[];input.evidence={};
 for(let i=0;i<1800;i++) {
   const prefix=`batch${i}/`;
   input.files.push(...sample.files.map(f=>({...f,path:prefix+f.path})));
   input.definitions.push(...sample.definitions.map(d=>({...d,definition_key:prefix+d.definition_key,file_path:prefix+d.file_path,evidence_ids:d.evidence_ids.map((id:string)=>prefix+id)})));
   for(const [id,e] of Object.entries(sample.evidence))input.evidence[prefix+id]={...e,evidence_id:prefix+id,file_path:prefix+e.file_path};
 }
 const result=groupReaderData(input);
 assert.equal(result.grouping.coverage.structural.mapped,10000);assert.equal(result.grouping.unassigned.length,800);assert.equal(result.definitions.length,10800);
});


test('a linked cross-file flow does not import foreign members into a structural module', () => {
 const input=fixture(), result=groupReaderData(input);
 const mods=result.capabilityCandidates.filter((c:any)=>c.category==='structural_module');
 result.mainlines=[{id:'flow',available:true,stages:[{keys:[input.definitions[0].definition_key,input.definitions[3].definition_key]}]}];
 mods[0].mainlines=['flow'];
 assert.deepEqual(createReaderCapabilityModel(result).members(mods[0].id),mods[0].definitions);
});

test('disconnected same-name declarations remain distinct navigable suggestions', () => {
 const input=fixture();
 for(let i=0;i<2;i++)input.definitions.push({...input.definitions[i],definition_key:'second:'+i,definition_span:{start_byte:0,end_byte:input.files[0].source.length}});
 call(input,0,1,'first');call(input,6,7,'second');
 const result=groupReaderData(input), suggestions=result.capabilityCandidates.filter((c:any)=>c.category==='business_candidate');
 assert.equal(suggestions.length,2);assert.equal(new Set(suggestions.map((c:any)=>c.id)).size,2);
 assert.doesNotThrow(()=>createReaderCapabilityModel(result));
});
