import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the shipped tree renderer; browser clicks are verified separately.
function render(files:string[],sourceRoot:string) {
 const source=readFileSync(process.env.READER_CLIENT_PATH ?? new URL('../../scripts/semantic-reader-client.js',import.meta.url),'utf8');
 const tree=source.slice(source.indexOf('  function tree() {'),source.indexOf('  function summary('));
 const nodes:any={tree:{innerHTML:''},'mainline-menu':{innerHTML:''}};
 runInNewContext(tree+';tree();',{
 D:{files:files.map(path=>({path})),sourceRoot},S:{context:'file',file:files[0]},functions:[{file_path:files[0],definition_key:'fn',qualified_name:'run'}],
 document:{querySelector:()=>({scrollTop:0}),querySelectorAll:()=>[]},$: (id:string)=>nodes[id],activeMembers:()=>new Set(),defs:new Map(),
 expanded:new Set(),openFiles:new Set(),E:(v:unknown)=>String(v),fileIcon:()=>'',capabilityMenu:()=>{},mainlines:[],
 });
 return nodes.tree.innerHTML as string;
}
test('source navigation preserves actual file identities across repository roots',()=>{
 for(const [files,root] of [
  [['src/context/index.ts','src/context/formatter.ts'],''],
  [['packages/zod/src/v3/helpers/parseUtil.ts'],'packages/zod/src/v3'],
  [['src/poetry/utils/cache.py'],''],
  [['src/main.ts','outside/helper.ts'],'src'],
 ] as [string[],string][]){const html=render(files,root);for(const path of files)assert.ok(html.includes(`data-file="${path}"`),path);assert.ok(html.includes('data-tree-fn="fn"'),'function nodes retain correct ownership');}
});
