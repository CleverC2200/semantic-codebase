import { reviewReaderRequirements, createReaderRequirementReview, createReaderRequirementStore, mergeReaderRequirementReviews } from './semantic-reader-requirements.mjs';

// The panel owns the local document workflow; source navigation stays in the reader.
export function createReaderRequirementPanel(data, { storage, onChange, beforeReview = async () => {} }) {
  const E = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const labels = { supported: '支持 · 待复核', violated: '违反 · 待复核', unknown: '缺少证据' };
  const proofs = { static_support: '源码依据', local_test_record: '本地测试记录 · 未重跑', runtime_observation_record: '导入运行观测 · 未重跑', unknown: '尚无有效证明' };
  const gaps = { evidence_missing: '缺少 Evidence', definition_missing: '缺少实现位置', repository_mismatch: '仓库不同', snapshot_or_overlay_mismatch: '源码或分析版本不同', requirement_version_mismatch: '条款版本或内容不同', judgement_incomplete: '判断理由或条件不完整', definition_binding_invalid: '函数内容或身份无法核对', evidence_binding_invalid: '依据内容或版本无法核对', mainline_binding_invalid: '主线引用失效', verification_scope_invalid: '验证记录不适用于本条款', verification_artifact_invalid: '验证产物缺失或摘要不匹配', conflicting_evidence: '存在相反依据或失败验证，需解决冲突', real_execution_not_proven: '真实执行未验证', imported_observation_not_reexecuted: '运行观测来自导入，未在此重新执行' };
  const library = createReaderRequirementStore(data, storage);
  let document = data.requirements ?? null, result = null, selected = null, error = '', notice = '', busy = false, savedDocuments = [], generation = 0;
  function refreshLibrary() { try { savedDocuments = library.documents(); } catch (e) { error = '本机记录无法读取，原记录已保留：' + e.message; } }
  refreshLibrary();
  async function refresh() {
    const current = ++generation;
    if (!document) { result = null; onChange(); return; }
    busy = true; onChange();
    try { await beforeReview(document); const next = await reviewReaderRequirements(data, document); if (current === generation) { result = next; selected = next.clauses.some(c => c.id === selected) ? selected : next.clauses[0]?.id; } }
    catch (e) { if (current === generation) { error = '核对表不可用：' + e.message; result = null; } }
    finally { if (current === generation) { busy = false; onChange(); } }
  }
  function download(value, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const a = window.document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function view() {
    const clause = result?.clauses.find(c => c.id === selected);
    const currentReview = clause?.reviews.find(r => r.valid) ?? clause?.reviews[0];
    const options = data.definitions.filter(d => ['function', 'method'].includes(d.kind)).map(d => `<option value="${E(d.definition_key)}" ${currentReview?.definitionKeys?.includes(d.definition_key) ? 'selected' : ''}>${E(d.qualified_name)} · ${E(d.file_path)}</option>`).join('');
    const evidenceButtons = review => (review.evidence ?? []).map(e => `<button data-group-evidence="${E(e.evidence_id)}">${E(e.file_path)} · L${E(e.line ?? '?')}</button>`).join('');
    return `<section class="requirements-workbench"><h1>需求核对</h1><p class="lede">逐条看规则、实现依据和验证范围。支持表示记录中的判断，仍需核对；源码支持不等于运行验收。</p><div class="requirement-actions"><label class="upload-control">导入条款／核对表<input type="file" accept=".json,application/json" data-requirement-import></label><button data-requirement-template>下载条款模板</button>${document ? '<button data-requirement-export>导出核对表</button><button data-requirement-save>保存到本机</button><label class="upload-control">关联验证产物<input type="file" accept=".json,application/json" data-requirement-verification></label>' : ''}</div>${savedDocuments.length ? `<label>本机已保存版本 <select data-requirement-library><option value="">选择版本</option>${savedDocuments.map((d, i) => `<option value="${i}">${E(d.set.title)} · ${E(d.set.version)} · ${d.reviews.length} 条核对记录</option>`).join('')}</select></label>` : ''}<p role="alert" class="requirement-error">${E(error)}${error && document ? '<button data-requirement-retry>重新核对</button>' : ''}</p><p role="status">${E(busy ? '正在核对条款、源码与验证产物…' : notice)}</p>${!result ? `<p>${document ? '等待有效核对结果。' : '尚未导入条款。可下载模板，填入原文、来源和版本后导入；本机不会执行测试或被索引程序。'}</p>` : `<h2>${E(result.set.title)}</h2><p class="muted">条款版本 ${E(result.set.version)} · ${E(result.set.source)}</p><details><summary>正在核对的版本</summary><p>Snapshot ${E(result.snapshot)}</p><p>条款摘要 ${E(result.setDigest)}</p></details><div class="requirement-table-wrap"><table class="requirement-table"><thead><tr><th>条款</th><th>判断</th><th>证明范围</th><th>阅读</th></tr></thead><tbody>${result.clauses.map(c => `<tr ${c.id === selected ? 'aria-selected="true"' : ''}><td><strong>${E(c.id)}</strong> ${E(c.text)}</td><td>${c.state === 'conflict' ? '存在冲突' : c.state === 'needs_review' ? '版本或依据待复核' : labels[c.decision]}</td><td>${proofs[c.proofLevel]}</td><td><button data-requirement-clause="${E(c.id)}" aria-pressed="${c.id === selected}">核对 ${E(c.id)}</button></td></tr>`).join('')}</tbody></table></div>${clause ? `<section id="requirement-detail" class="requirement-detail"><h2>${E(clause.id)} · 原始要求</h2><p>${E(clause.text)}</p><p class="muted">来源：${E(clause.source)}</p><h3>条件、理由与实现</h3>${clause.reviews.map(r => `<article class="requirement-record"><p><strong>${r.valid ? labels[r.decision] : '历史／不可用判断'}</strong> · ${E(r.actor || '记录人未注明')} · ${r.origin === 'llm_inferred' ? 'AI 推断，未验证' : '记录人自报，未独立认证'}</p><p>条件：${E(r.condition)}</p><p>${E(r.rationale)}</p>${r.valid ? `<div class="links">${(r.definitionKeys ?? []).map(key => `<button data-read-function="${E(key)}">${E(data.definitions.find(d => d.definition_key === key)?.qualified_name ?? '定义缺失')}</button>`).join('')}${r.mainlineId ? `<button data-mainline="${E(r.mainlineId)}">阅读对应主线</button>` : ''}</div><div class="links">${evidenceButtons(r)}</div>` : '<p>该记录不能作为当前结论；保留原理由供复核。</p>'}${r.verification?.length ? `<details><summary>验证产物 · ${r.verification.length}</summary>${r.verification.map(v => `<article><p>${E(v.kind)} · ${E(v.status)} · ${E(v.condition)}</p><p>${E(v.artifact.name)} · 摘要已核对，未重新执行。</p><pre>${E(v.artifact.content)}</pre></article>`).join('')}</details>` : ''}</article>`).join('') || '<p>还没有实现依据和判断。</p>'}<h3>待核对事项</h3><ul>${clause.gaps.map(g => `<li>${E(gaps[g] ?? g)}</li>`).join('')}</ul><details class="requirement-editor"><summary>记录我的核对</summary><form id="requirement-review"><label>判断<select name="decision"><option value="unknown">缺少证据</option><option value="supported">支持</option><option value="violated">违反</option></select></label><label>实现函数<select name="definitionKey">${options}</select></label><p class="muted">引用所选函数的声明范围；保存前请核对源码。记录不会修改事实或自动放行需求。</p><label>适用条件<textarea name="condition" required maxlength="2000">${E(currentReview?.condition ?? '')}</textarea></label><label>判断理由<textarea name="rationale" required maxlength="3000"></textarea></label><label>记录人<input name="actor" required maxlength="100" autocomplete="name"></label><button>添加核对记录</button></form></details></section>` : ''}${result.history.length ? `<details><summary>已删除条款的历史记录 · ${result.history.length}</summary>${result.history.map(r => `<p>${E(r.clauseId)}：${E(r.rationale)} · 历史判断，不适用于当前条款集合。</p>`).join('')}</details>` : ''}`}</section>`;
  }
  async function handleClick(el) {
    if (el.hasAttribute('data-requirement-retry')) { error = ''; await refresh(); return true; }
    if (el.dataset.requirementClause) { selected = el.dataset.requirementClause; onChange(); return true; }
    if (el.hasAttribute('data-requirement-template')) {
      download({ schema: 'reader-requirements-v1', set: { id: 'my-requirements', version: '1', title: '需求核对', source: '填写需求来源', clauses: [{ id: 'R1', text: '填写完整需求原文', source: '填写条款来源' }] }, reviews: [] }, 'requirements-template.json'); return true;
    }
    if (el.hasAttribute('data-requirement-export')) { download(document, 'requirements-' + document.set.version + '.json'); return true; }
    if (el.hasAttribute('data-requirement-save')) {
      try { document = await library.save(document); refreshLibrary(); notice = '已保存到本机；原有判断保持不变。'; error = ''; await refresh(); }
      catch (e) { error = '未保存，原记录已保留：' + e.message; }
      onChange(); return true;
    }
    return false;
  }
  async function handleChange(target) {
    if (target.hasAttribute('data-requirement-library')) {
      if (target.value !== '') { document = structuredClone(savedDocuments[Number(target.value)]); error = ''; await refresh(); }
      return true;
    }
    if (!target.hasAttribute('data-requirement-import') && !target.hasAttribute('data-requirement-verification')) return false;
    const file = target.files?.[0]; if (!file) return true;
    target.value = ''; // Selecting the same corrected file must trigger another attempt.
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('文件超过 4 MiB，请缩小核对范围');
      const value = JSON.parse(await file.text());
      let candidate;
      if (target.hasAttribute('data-requirement-import')) {
        candidate = value;
        // A new version keeps previous reasons visible, without treating them as current judgements.
        if (document?.set.id === candidate.set?.id) {
          candidate = { ...candidate, reviews: mergeReaderRequirementReviews(document.reviews, candidate.reviews ?? []) };
        }
      } else {
        if (!document || !result) throw new Error('先导入条款并记录实现依据');
        if (!Array.isArray(value) || value.length > 200) throw new Error('验证产物应为不超过 200 项的记录列表');
        candidate = structuredClone(document);
        let attached = 0;
        for (const clause of result.clauses) {
          const prior = clause.reviews.find(r => r.valid), verification = value.filter(v => Array.isArray(v?.clauseIds) && v.clauseIds.includes(clause.id));
          if (prior && verification.length) {
            const original = document.reviews.find(r => r.id === prior.id);
            candidate.reviews.push({ ...original, id: crypto.randomUUID(), verificationOrigin: 'imported_unverified', verification }); attached++;
          }
        }
        if (!attached) throw new Error('没有找到适用条款和实现依据，未关联产物');
      }
      await beforeReview(candidate);
      await reviewReaderRequirements(data, candidate);
      if (candidate.reviews.some(r => r.repository !== data.repository)) throw new Error('核对记录来自其他仓库');
      document = candidate; error = ''; notice = '已导入本机，未执行测试；检查证明范围与待核对事项。'; await refresh();
    } catch (e) { error = '未导入，当前记录已保留：' + e.message; onChange(); }
    return true;
  }
  async function handleSubmit(form) {
    if (form.id !== 'requirement-review') return false;
    try {
      const values = new FormData(form), key = values.get('definitionKey'), definition = data.definitions.find(d => d.definition_key === key);
      await beforeReview({ reviews: [{ evidenceIds: definition?.evidence_ids ?? [], sourceDigests: definition ? { [definition.file_path]: definition.content_hash } : {} }] });
      const record = await createReaderRequirementReview(data, document.set, { id: crypto.randomUUID(), clauseId: selected,
        decision: values.get('decision'), condition: values.get('condition'), rationale: values.get('rationale'), actor: values.get('actor'),
        definitionKeys: definition ? [key] : [], evidenceIds: definition?.evidence_ids ?? [] });
      document = { ...document, reviews: [...document.reviews, record] }; error = ''; notice = '已添加本次核对；使用“保存到本机”保留，或导出交接。'; await refresh();
    } catch (e) { error = '未添加：' + e.message; onChange(); }
    return true;
  }
  return { view, open: refresh, handleClick, handleChange, handleSubmit };
}
