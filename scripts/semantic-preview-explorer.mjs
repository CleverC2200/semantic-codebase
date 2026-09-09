import { canonicalJson } from "../dist/contract/hash.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderDiagnosticHtml } from "./semantic-preview-diagnostics.mjs";

import { bindReaderMainlines } from "./semantic-reader-mainlines.mjs";
import { callableSignature } from "./semantic-reader-signature.mjs";
import { pythonCallableSignature } from "./semantic-reader-python-signature.mjs";
const capabilityCandidates = JSON.parse(readFileSync(new URL("./semantic-reader-capabilities.json", import.meta.url), "utf8"));
const explanations = JSON.parse(readFileSync(new URL("./semantic-reader-explanations.json", import.meta.url), "utf8"));

export function buildReaderData({overlay, definitionsByKey, sourceFiles = [], manifest, structuralGraph, runtime, reader = {}, revision = null, repositoryUrl = null}) {
  const allEvidence = [...new Map([...(structuralGraph?.evidence ?? []), ...overlay.evidence].map(e => [e.evidence_id, e])).values()];
  const sources = new Map(sourceFiles.map(f => [f.relative_path, {bytes:f.source_bytes, digest:createHash('sha256').update(f.source_bytes).digest('hex')}]));
  const files = (manifest?.files ?? [...new Map(overlay.evidence.map(e=>[e.file_path,{relative_path:e.file_path,source_digest:e.source_digest}])).values()]).map(f=>{
    const source=sources.get(f.relative_path); const verified=source?.digest===f.source_digest;
    const entry=(reader.explanations ?? explanations).files[f.relative_path];
    const presentation=verified&&entry?.source_digest===f.source_digest?{...entry,basis:'llm_inferred',verified:false}:null;
    return {path:f.relative_path, source_digest:f.source_digest, verified, source:verified?source.bytes.toString('utf8'):null,presentation};
  });
  const byPath=new Map(files.map(f=>[f.path,f]));
  const definitions=[...definitionsByKey.values()].map(d=>{
    const file=byPath.get(d.file_path);const bytes=file?.verified?sources.get(d.file_path).bytes:null;
    const rawType=overlay.facts.find(f=>f.kind==='symbol_type'&&f.subject.definition_key===d.definition_key)?.value.type;
    const declaration=bytes?.subarray(d.definition_span.start_byte,d.definition_span.end_byte).toString('utf8')??'';
    const getter=/^\s*(?:public\s+|protected\s+|private\s+|static\s+)*get\s/.test(declaration);
    const signature=d.language==='python'?pythonCallableSignature(declaration):callableSignature(rawType)??(getter&&rawType?{inputs:[],output:rawType,raw:rawType,getter:true}:null);
    return {...d,signature,presentation:file?.presentation?.functions?.[d.qualified_name]?{...file.presentation.functions[d.qualified_name],basis:'llm_inferred',verified:false}:null,rawType,line:bytes?bytes.subarray(0,d.definition_span.start_byte).toString('utf8').split('\n').length:null,
      endLine:bytes?bytes.subarray(0,d.definition_span.end_byte).toString('utf8').split('\n').length:null};
  });
  // Only embed fact kinds consumed by the reader. The authoritative overlay remains intact.
  const facts=overlay.facts.filter(f=>['call_target','control_flow','effect','symbol_type','data_flow','call_data_flow'].includes(f.kind));
  const evidence=Object.fromEntries(allEvidence.map(e=>{
    const source=sources.get(e.file_path);const valid=source?.digest===e.source_digest&&e.span.start_byte>=0&&e.span.end_byte<=source.bytes.length;
    return [e.evidence_id,{...e,line:valid?source.bytes.subarray(0,e.span.start_byte).toString('utf8').split('\n').length:null}];
  }));
  const data={schema:"reader-snapshot-v1",files,definitions,facts,evidence,repository:overlay.repository_id ?? "local",revision,repositoryUrl,snapshot:overlay.snapshot_id,overlayHash:overlay.overlay_hash,relations:(structuralGraph?.relations ?? []).filter(r => r.kind === "INHERITS"),relationCandidates:structuralGraph?.relation_candidates,relationCoverage:structuralGraph?.coverage ?? {status:"unknown"},coverage:overlay.coverage,capabilityCandidates:reader.capabilities ?? capabilityCandidates,project:reader.project ?? "Zod / v3",sourceRoot:reader.sourceRoot ?? "packages/zod/src/v3",initialFile:reader.initialFile,overview:reader.overview,searchAliases:reader.searchAliases};
  const { observation_set_hash, ...runtimeBody } = runtime ?? {};
  const runtimeValid = Boolean(runtime && runtime.repository_id === data.repository && runtime.snapshot_id === data.snapshot && runtime.semantic_overlay_hash === data.overlayHash && createHash('sha256').update(canonicalJson(runtimeBody)).digest('hex') === observation_set_hash);
  return {...data, groupingRelations:(structuralGraph?.relations ?? []).filter(r=>r.kind==='IMPORTS'), runtime: runtime ?? null, runtimeBinding: { valid: runtimeValid, reason: runtimeValid ? null : 'runtime_hash_or_version_mismatch' }, mainlines:bindReaderMainlines(data, reader.mainlines)};
}

export function renderSemanticPreview(input) {
  const model=buildReaderData({ ...input, revision: input.revision ?? input.receipt?.source_head ?? null });
  return renderReaderData(model, input.receipt, input.reader ? null : renderDiagnosticHtml(input));
}

// Refresh presentation without rebuilding or altering the frozen analysis.
export function renderReaderData(model, receipt, diagnosticHtml = null) {
  const E=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const data=JSON.stringify(model).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
  const css=readFileSync(new URL('./semantic-reader.css',import.meta.url),'utf8');
  const js = ['semantic-reader-query.mjs', 'semantic-reader-archify.mjs', 'semantic-reader-archify-inspection.mjs', 'semantic-reader-archify-ui.mjs', 'semantic-reader-guide.mjs', 'semantic-reader-comparison.mjs', 'semantic-reader-requirements.mjs', 'semantic-reader-requirements-ui.mjs', 'semantic-reader-loader.mjs', 'semantic-reader-risk.mjs', 'semantic-reader-capabilities.mjs', 'semantic-reader-graph.mjs', 'semantic-reader-behavior.mjs', 'semantic-reader-client.js']
    .map(name => readFileSync(new URL('./' + name, import.meta.url), 'utf8').replace(/^import .+ from ['"].+['"];?\n/gm, '').replace(/^export /gm, '')).join('\n');
  const legacy=(diagnosticHtml ?? `<main class="wrap"><h1>${E(model.project)} 本地分析记录</h1><p>仅静态分析；未执行应用，未调用在线模型。解释为待核验推断。</p><pre>${E(JSON.stringify(receipt,null,2))}</pre></main>`).match(/<main class="wrap">([\s\S]*)<\/main>/)?.[1]??'';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${E(model.project)} · 源码阅读工作台</title><style>${css}</style></head><body>
<header class="top"><strong>Semantic Codebase</strong><span class="project">${E(model.project)}</span><div id="global-search-host"><label class="sr-only" for="global-search">搜索文件、函数、主线</label><input id="global-search" role="combobox" aria-expanded="false" aria-controls="global-results" aria-autocomplete="list" autocomplete="off" placeholder="搜索中文职责、文件、函数或主线"><kbd>⌘ K</kbd><div id="global-results" role="listbox" aria-label="全局搜索结果" hidden></div></div><button data-mobile-search class="mobile-search">搜索</button><span class="scope">静态分析 / partial</span><button class="directory-toggle" data-directory-toggle aria-expanded="false">导航</button><button data-project-overview>项目总览</button><button data-open-requirements>需求核对</button><button data-open-comparison>变更阅读</button><button id="report">验收资料</button></header>
<div id="reader-load-state" role="status" hidden></div><div class="workspace"><aside class="sidebar" aria-label="项目导航" data-navigation="source"><nav class="sidebar-modes" aria-label="导航方式"><button data-navigation="business" aria-pressed="false">业务能力</button><button data-navigation="source" aria-pressed="true">源码目录</button></nav><section class="business-navigation"><div id="capability-menu"></div></section><details class="sidebar-section business-navigation" open><summary>项目主线 <small>候选</small></summary><div id="mainline-menu"></div></details><details class="sidebar-section source-navigation" open><summary>源码目录 <small>${model.files.length} 文件</small></summary><p class="tree-root">${E(model.sourceRoot || model.project)}</p><p class="tree-legend"><span class="route-dot" aria-hidden="true"></span>相关高亮 · 完整目录保持不变</p><div id="tree"></div><p class="scope-note">仅包含本次冻结分析的文件。</p></details></aside>
<main id="reading"><nav id="reading-nav" aria-label="阅读模式"><button id="files-tab" aria-pressed="true">文件阅读</button><button id="flows-tab" aria-pressed="false">函数流程</button><button id="calls-tab" aria-pressed="false" hidden>调用关系</button><div id="function-picker"></div></nav><div id="context-bar"></div><div id="center"></div></main>
<div id="inspector-resize" role="separator" tabindex="0" aria-label="调整详情宽度" aria-orientation="vertical" aria-valuemin="360" aria-valuemax="680" aria-valuenow="440" hidden></div><aside id="inspector" aria-label="源码与解释" hidden></aside></div>
<dialog id="report-dialog"><button id="close-report">关闭验收资料</button><div class="legacy">${legacy}</div></dialog><div id="reader-status" role="status" class="sr-only"></div><script id="reader-data" type="application/json">${data}</script><script>${js}</script><noscript>请启用 JavaScript 使用目录与联动阅读。</noscript></body></html>`;
}
