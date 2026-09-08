export function renderDiagnosticHtml({ receipt, overlay, pythonOverlay, runtime, evidenceAnswer, focusFacts, definitionsByKey, evidenceById }) {
  const kindLabels = {
    application_flow: "应用主线",
    call_target: "调用目标",
    control_step: "控制步骤",
    control_flow: "函数内控制流（部分支持）",
    data_flow: "局部定义使用与参数返回（部分支持）",
    call_data_flow: "一跳参数返回传播（静态可能）",
    effect: "副作用",
    entrypoint: "入口",
    symbol_type: "符号类型",
    import_target: "导入目标",
    reference_target: "引用目标",
  };
  const basisLabels = {
    compiler_exact: "编译器精确",
    framework_heuristic: "规则推断",
    static_possible: "静态可能",
  };
  const cards = [
    ["源码文件", receipt.corpus.file_count],
    ["结构定义", receipt.counts.definitions],
    ["语义事实", receipt.counts.semantic_facts],
    ["源码证据", receipt.counts.semantic_evidence],
  ].map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
  const kindRows = Object.entries(receipt.counts.facts_by_kind)
    .map(([kind, count]) => `<tr><td>${escapeHtml(kindLabels[kind] ?? kind)}</td><td>${count}</td></tr>`)
    .join("");
  const basisRows = Object.entries(receipt.counts.facts_by_basis)
    .map(([basis, count]) => `<tr><td><span class="basis ${basis}">${escapeHtml(basisLabels[basis] ?? basis)}</span></td><td>${count}</td></tr>`)
    .join("");
  const factRows = focusFacts.slice(0, 160).map((fact) => {
    const subject = fact.subject.kind === "definition"
      ? definitionsByKey.get(fact.subject.definition_key)?.qualified_name ?? fact.subject.definition_key
      : fact.subject.file_path;
    const firstEvidence = evidenceById.get(fact.evidence_ids[0]);
    const location = firstEvidence
      ? `${firstEvidence.file_path}:${firstEvidence.span.start_byte}-${firstEvidence.span.end_byte}`
      : "无";
    return `<tr><td>${escapeHtml(kindLabels[fact.kind] ?? fact.kind)}</td><td>${escapeHtml(subject)}</td><td><span class="basis ${fact.basis.kind}">${escapeHtml(basisLabels[fact.basis.kind] ?? fact.basis.kind)}</span></td><td><code>${escapeHtml(compactValue(fact.value))}</code></td><td><code>${escapeHtml(location)}</code></td></tr>`;
  }).join("");
  const unknown = overlay.coverage.status === "partial"
    ? `存在 ${overlay.diagnostics.length} 条 TypeScript 诊断，因此局部事实可用，但不能据此作仓库级穷举结论。`
    : "当前分析范围完整；动态调用仍按单条事实的 static-possible 状态解释。";
  const pythonRows = Object.entries(receipt.python.facts_by_kind)
    .map(([kind, count]) => `<tr><td>${escapeHtml(kindLabels[kind] ?? kind)}</td><td>${count}</td></tr>`)
    .join("");
  const capabilityRows = runtime.capability_candidates.map((candidate) => `<tr><td>${escapeHtml(candidate.title)}</td><td>Candidate</td><td>${candidate.observed_definition_keys.length}</td><td>${candidate.static_flow_fact_ids.length}</td></tr>`).join("");
  const answerRows = evidenceAnswer.findings.map((finding) => `<li>${escapeHtml(finding.text)} <span class="muted">(${finding.fact_ids.length} facts / ${finding.evidence_ids.length} evidence / ${escapeHtml(finding.basis_kinds.join(", "))})</span></li>`).join("");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Semantic Codebase V0 预览</title>
<style>
:root{font-family:Inter,"PingFang SC",system-ui,sans-serif;color:#172033;background:#f3f6fb}body{margin:0}.wrap{max-width:1280px;margin:auto;padding:40px 28px 72px}h1{font-size:30px;margin:0 0 8px}h2{margin-top:38px}.muted{color:#687386}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:26px 0}.cards article,.panel{background:white;border:1px solid #dfe5ef;border-radius:14px;box-shadow:0 8px 24px #1720330a}.cards article{padding:20px}.cards span{display:block;color:#687386}.cards strong{display:block;font-size:30px;margin-top:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel{padding:20px;overflow:auto}.notice{border-left:4px solid #d98b19;background:#fff8e8;padding:14px 18px;border-radius:8px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid #edf0f5}th{color:#596579;background:#f8fafc;position:sticky;top:0}.basis{display:inline-block;border-radius:999px;padding:3px 8px;font-size:12px;white-space:nowrap}.compiler_exact{background:#e6f6ee;color:#137548}.static_possible{background:#fff2cc;color:#8a6100}.framework_heuristic{background:#eeeaff;color:#5d42a8}code{font-family:"SFMono-Regular",Consolas,monospace;white-space:pre-wrap;word-break:break-word}.facts{max-height:620px;overflow:auto}@media(max-width:850px){.cards,.grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.cards,.grid{grid-template-columns:1fr}.wrap{padding:24px 14px}}
</style></head><body><main class="wrap">
<p class="muted">Semantic Codebase · TypeScript Compiler Preview</p><h1>Zod v3 语义理解预览</h1>
<p class="muted">Snapshot <code>${escapeHtml(receipt.snapshot.snapshot_id.slice(0, 16))}…</code> · Overlay <code>${escapeHtml(receipt.snapshot.overlay_hash.slice(0, 16))}…</code> · ${receipt.runtime.elapsed_ms} ms</p>
<section class="cards">${cards}</section>
<p class="notice"><strong>如何理解 unknown：</strong>${escapeHtml(unknown)}</p>
<section class="grid"><div class="panel"><h2>生成了什么</h2><table><thead><tr><th>语义类型</th><th>数量</th></tr></thead><tbody>${kindRows}</tbody></table></div>
<div class="panel"><h2>证据地位</h2><table><thead><tr><th>来源</th><th>数量</th></tr></thead><tbody>${basisRows}</tbody></table></div></section>
<h2>Python / Pyright 纵切片</h2><p class="muted">${receipt.python.file_count} 个文件 · ${receipt.python.semantic_facts} 条语义事实 · Pyright ${escapeHtml(receipt.python.pyright)} · Coverage ${escapeHtml(receipt.python.coverage.status)} · ${receipt.python.elapsed_ms} ms</p>
<div class="panel"><table><thead><tr><th>语义类型</th><th>数量</th></tr></thead><tbody>${pythonRows}</tbody></table></div>
<h2>运行时观测与能力候选</h2><p class="muted">仅导入冻结 OTLP JSON；${receipt.runtime.observations} 个 span 中匹配 ${receipt.runtime.matched_observations} 个。Candidate 不会自动升级为正式能力。</p>
<div class="panel"><table><thead><tr><th>名称</th><th>状态</th><th>观测到的定义</th><th>关联静态主线</th></tr></thead><tbody>${capabilityRows}</tbody></table></div>
<h2>中文 Evidence Answer</h2><div class="panel"><p><strong>${escapeHtml(evidenceAnswer.summary)}</strong></p><ul>${answerRows}</ul><p class="muted">状态：${escapeHtml(evidenceAnswer.status)}。回答只能引用 Context Package 内已有的 fact 与 evidence。</p></div>
<h2>文件明细：parseUtil.ts</h2><p class="muted">展示该文件前 160 条语义事实。每行都包含主体、证据地位、内容和 UTF-8 字节范围。</p>
<div class="panel facts"><table><thead><tr><th>类型</th><th>主体</th><th>地位</th><th>内容</th><th>Evidence</th></tr></thead><tbody>${factRows}</tbody></table></div>
</main></body></html>`;
}

function compactValue(value) {
  const text = JSON.stringify(value);
  return text.length <= 260 ? text : `${text.slice(0, 259)}…`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
