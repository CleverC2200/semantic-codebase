import { createArchifyProjection, readerArchifyDigest, readerArchifyEvidenceIds } from './semantic-reader-archify.mjs';
import { readerCanonicalJson } from './semantic-reader-comparison.mjs';
import { readerArchifyFocus, inspectReaderArchify, readerArchifyBoundaryText } from './semantic-reader-archify-inspection.mjs';

export function createReaderArchifyPanel(data, loader, { onChange, onLoaded, announce }) {
  const states = new Map(), wired = new WeakSet();
  const E = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const state = id => {
    if (!states.has(id)) states.set(id, { busy: false, error: '', result: null, open: false, selected: null, detail: null, request: 0, path: 'all', stage: null });
    return states.get(id);
  };
  const root = id => {
    const el = document.getElementById('archify-reader');
    return el?.dataset.mainline === id ? el : null;
  };
  const basisLabel = basis => ({ compiler_exact: '编译器精确解析', static_possible: '静态可能', framework_heuristic: '框架启发式', llm_inferred: 'AI 推断 · 未验证', runtime_observed: '单次运行观测' })[basis] ?? '来源未知';
  const download = (text, name, type) => {
    const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function prepare(id) {
    const s = state(id); if (s.busy) return;
    s.busy = true; s.error = ''; onChange();
    try {
      let result;
      if (data.archifyService) {
        const response = await fetch(data.archifyService.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Token': data.archifyService.token }, body: JSON.stringify({ mainline: id }) });
        result = await response.json(); if (!response.ok) throw new Error(result.error ?? '本地图生成失败。');
        const binding = result.projection?.binding;
        if (binding?.snapshot !== data.snapshot || binding.repository !== data.repository || binding.overlay_hash !== (data.overlayHash ?? null) || binding.revision !== data.revision || binding.mainline_id !== id ||
          readerCanonicalJson(result.receipt?.binding) !== readerCanonicalJson(binding) || result.receipt?.input_sha256 !== result.projection.input_sha256 ||
          await readerArchifyDigest(JSON.stringify(result.projection.spec, null, 2) + '\n') !== result.receipt.specification.sha256 ||
          await readerArchifyDigest(JSON.stringify(result.projection, null, 2) + '\n') !== result.receipt.projection.sha256) throw new Error('生成结果版本或摘要不匹配，已保留原图。');
        const expected = '/archify/artifact/' + result.receipt.artifact.sha256 + '.html';
        if (result.artifactUrl !== expected || Object.entries({ html: 'diagram.html', json: 'diagram.archify.json', proof: 'projection.json', receipt: 'receipt.json' }).some(([key, name]) =>
          result.downloads?.[key] !== '/archify/download/' + result.receipt.input_sha256 + '/' + name)) throw new Error('交付资源地址不匹配，已保留原图。');
      } else {
        const line = data.mainlines.find(m => m.id === id), keys = [...new Set(line.stages.flatMap(s => s.keys))];
        for (const key of keys) await loader.definition(key);
        const ids = new Set();
        for (const d of data.definitions.filter(d => keys.includes(d.definition_key))) { await loader.source(d.file_path); readerArchifyEvidenceIds(d).forEach(id => ids.add(id)); }
        for (const f of data.facts.filter(f => f.kind === 'call_target' && keys.includes(f.subject?.definition_key))) readerArchifyEvidenceIds(f).forEach(id => ids.add(id));
        const evidence = await loader.evidence([...ids]);
        for (const path of new Set(evidence.map(e => e.file_path))) await loader.source(path);
        onLoaded(); result = { projection: await createArchifyProjection(data, id), receipt: null };
      }
      s.result = result; s.open = true; s.selected = null; s.detail = null; s.path = 'all'; s.stage = null; s.request++;
      announce('已核对当前主线范围，可预览或导出。');
    } catch (error) { s.error = error.message; announce(error.message); }
    finally { s.busy = false; onChange(); root(id)?.querySelector('[data-archify-action=prepare]')?.focus({ preventScroll: true }); }
  }
  function sourceButton(node, label = '回到此定义源码') {
    return `<button data-enter-file="${E(node.file_path)}" data-enter-key="${E(node.definition_key)}">${E(label)}</button>`;
  }
  function selectedHtml(s) {
    const detail = s.detail;
    if (!detail) return '<p>选择图中节点或关系，按需加载来源与 Evidence。也可使用下方来源目录。</p>';
    const { node, edge, nodes, binding, evidence, behavior } = detail;
    const heading = node?.qualified_name ?? nodes.find(n => n.id === edge.from).qualified_name + ' → ' + nodes.find(n => n.id === edge.to).qualified_name;
    return `<h3>${E(heading)}</h3>${node ? `<p>Definition · ${E(node.file_path)} · L${node.line}–${node.end_line}</p>` : `<p>Relation · call_target · ${E(basisLabel(edge.basis))} (${E(edge.basis)})</p>`}
      <p class="muted">Coverage ${E(detail.coverage.status)} · 静态分析不证明实际执行。</p>
      <div class="mainline-actions">${nodes.map(n => sourceButton(n, '阅读 ' + n.qualified_name + ' 源码')).join('')}</div>
      <details><summary>版本与身份</summary><dl><dt>Snapshot</dt><dd>${E(binding.snapshot)}</dd><dt>revision</dt><dd>${E(binding.revision)}</dd><dt>Overlay</dt><dd>${E(binding.overlay_hash ?? 'unknown')}</dd>${nodes.map(n => `<dt>Definition · ${E(n.qualified_name)}</dt><dd>${E(n.definition_key)}</dd>`).join('')}${edge ? `<dt>Fact</dt><dd>${edge.fact_ids.map(E).join('<br>')}</dd>` : ''}</dl></details>
      <h4>Evidence · ${evidence.length}</h4>${evidence.map(e => `<details class="archify-evidence"><summary>${E(e.file_path)} · L${e.line}–${e.end_line}</summary><p>Evidence ${E(e.evidence_id)}</p><p class="muted">${E(e.producer ?? e.adapter_id ?? '来源标识未提供')} · SHA-256 ${E(e.source_digest)}</p><pre><code>${E(e.excerpt)}</code></pre>${e.definition_key ? sourceButton(nodes.find(n => n.definition_key === e.definition_key), '阅读对应定义') : ''}</details>`).join('')}
      ${node ? `<details><summary>Behavior Fact · ${behavior.length}</summary><p>来源等级分别保留；AI 推断说明未经验证，不进入权威静态事实。</p>${behavior.map(f => `<details><summary>${E(f.kind)} · ${E(basisLabel(f.basis?.kind))}</summary><p>Claim Basis ${E(f.basis?.kind ?? 'unknown')} · Fact ${E(f.fact_id)}</p><pre>${E(JSON.stringify(f.value, null, 2))}</pre></details>`).join('') || '<p>当前范围未提取到行为事实；不能据此判断没有行为。</p>'}</details>` : ''}`;
  }
  function explorationHtml(s) {
    const p = s.result.projection, x = p.exploration, r = x.runtime;
    return `<div class="archify-focus-controls" role="group" aria-label="Archify 路径与阶段聚焦">
      <div class="mainline-actions">${[['all', '全部路径'], ['success', '正常结果路径'], ['failure', '失败／中止路径']].map(([kind, title]) => `<button data-archify-path="${kind}" aria-pressed="${s.path === kind && !s.stage}" ${kind !== 'all' && !x.stages.some(t => t.outcome === kind) ? 'disabled' : ''}>${title}</button>`).join('')}</div>
      <div class="mainline-actions" role="group" aria-label="聚焦主线阶段">${x.stages.map(t => `<button data-archify-stage="${E(t.id)}" aria-pressed="${s.stage === t.id}">${E(t.title)}</button>`).join('')}</div>
      <p class="muted">阶段与结果路径为 AI 推断、未验证；聚焦只标出相关定义和静态调用。没有对应结果标签时，路径按钮不可用。</p><p id="archify-focus-status" role="status"></p></div>
      <details><summary>异步、状态与恢复边界</summary><ul>${x.stages.filter(t => t.boundary !== 'unknown' || t.outcome === 'failure').map(t => `<li>${E(t.title)} · ${t.boundary === 'async' ? '异步候选' : t.boundary === 'state' ? '状态候选' : '失败／中止候选'} · 未验证</li>`).join('')}<li>重试、事务、补偿和外层恢复策略尚无完整证据。</li></ul></details>
      <details><summary>运行观测 · ${r.status === 'unavailable' ? '不可用' : '单次执行'}</summary><p>观测与静态图分层保留；函数有 Span 不证明内部阶段执行，也不证明其他路径不存在。</p>${r.status === 'unavailable' ? `<p>${E(readerArchifyBoundaryText({ reason: r.reason }))}</p>` : `<dl><dt>Execution</dt><dd>${E(r.execution_id)}</dd><dt>Trace SHA-256</dt><dd>${E(r.trace_digest)}</dd><dt>Observation Set SHA-256</dt><dd>${E(r.observation_set_hash)}</dd></dl><p>Coverage ${E(r.coverage?.status ?? 'unknown')} · 主线外或未映射片段 ${r.unmapped_count}</p><ul>${p.nodes.map(n => `<li>${E(n.qualified_name)} · ${r.observations.filter(o => o.definition_key === n.definition_key).length} 个函数观测 · 阶段执行未知</li>`).join('')}</ul><details><summary>观测记录（runtime_observed）</summary><pre>${E(JSON.stringify(r.observations, null, 2))}</pre></details>`}</details>`;
  }
  function exportsHtml(s) {
    const labels = { json: '下载 Archify JSON', proof: '下载投影证据', html: '下载离线 HTML', receipt: '下载交付收据' };
    return `<div class="mainline-actions">${Object.entries(labels).filter(([key]) => s.result.receipt || ['json', 'proof'].includes(key)).map(([key, label]) => s.result.downloads?.[key]
      ? `<a class="archify-download" href="${E(s.result.downloads[key])}" download>${label}</a>` : `<button data-archify-action="${key}">${label}</button>`).join('')}</div>`;
  }
  function view(id) {
    const s = state(id), p = s.result?.projection;
    return `<section id="archify-reader" data-mainline="${E(id)}" class="archify-reader" aria-label="Archify 展示"><div class="mainline-actions"><button data-archify-action="prepare" ${s.busy ? 'disabled' : ''}>${s.busy ? '正在核对并生成…' : data.archifyService ? '预览 Archify 图' : '准备 Archify 图规格'}</button>${s.open ? '<button data-archify-action="close">收起展示图</button>' : ''}</div><p role="alert" class="archify-error">${E(s.error)}</p>${p && s.open ? `<div class="archify-scope"><p>${p.nodes.length} 个定义 · ${p.edges.length} 条关系 · ${p.unknowns.length} 项边界 · Coverage ${E(p.coverage.status)}</p><details><summary>导出范围与版本</summary><p>Snapshot ${E(p.binding.snapshot)}<br>revision ${E(p.binding.revision)} · ${E(p.binding.projector_version)}</p><p>只包含当前主线的源码定位与证据元数据；静态调用不代表执行顺序。导出不包含按需加载的源码详情。</p></details>${exportsHtml(s)}</div>${explorationHtml(s)}${s.result.artifactUrl ? `<iframe id="archify-reader-frame" title="${E(data.mainlines.find(m => m.id === id).title)} · Archify 展示图" src="${E(s.result.artifactUrl)}"></iframe>` : '<p>此页面可导出规格；HTML 预览请使用本地 Archify 阅读入口。</p>'}<p class="archify-narrow-help">窄屏可在图面横向滚动；也可用下方来源目录阅读每个节点与关系。</p><div class="archify-source" id="archify-reader-source" role="region" aria-label="图节点与关系来源" tabindex="-1">${selectedHtml(s)}</div><details><summary>未知与候选边界 · ${p.unknowns.length}</summary><ul>${p.unknowns.map(u => `<li>${E(readerArchifyBoundaryText(u))}${u.count !== undefined ? ' · ' + E(u.count ?? 'unknown') : ''}${u.fact_id ? `<details><summary>Fact 身份</summary><code>${E(u.fact_id)}</code></details>` : ''}</li>`).join('')}</ul></details><details><summary>全部节点与关系的来源目录</summary><div class="links">${p.nodes.map(n => `<button data-archify-node="${E(n.id)}">节点 · ${E(n.qualified_name)}</button>`).join('')}${p.edges.map(e => `<button data-archify-edge="${E(e.id)}">关系 · ${E(p.nodes.find(n => n.id === e.from).qualified_name)} → ${E(p.nodes.find(n => n.id === e.to).qualified_name)} · ${E(basisLabel(e.basis))}</button>`).join('')}</div></details>` : ''}</section>`;
  }
  function showError(id, error) {
    const s = state(id); s.error = error.message;
    const el = root(id)?.querySelector('.archify-error'); if (el) el.textContent = s.error;
    announce(s.error);
  }
  async function select(id, selection) {
    const s = state(id), request = ++s.request;
    announce('正在核对所选来源与 Evidence…');
    try {
      const detail = await inspectReaderArchify(data, s.result.projection, selection, loader);
      if (s.request !== request) return;
      s.selected = selection; s.detail = detail; s.error = ''; onLoaded();
      if (s.stage || s.path !== 'all') applyFocus(id);
      const panel = root(id)?.querySelector('#archify-reader-source');
      if (panel) { panel.innerHTML = selectedHtml(s); panel.focus({ preventScroll: true }); panel.scrollIntoView({ block: 'nearest' }); }
      const error = root(id)?.querySelector('.archify-error'); if (error) error.textContent = '';
      announce('来源核对完成，可以阅读源码。');
    } catch (error) { if (s.request === request) showError(id, error); }
  }
  function applyFocus(id) {
    const s = state(id), p = s.result?.projection, el = root(id); if (!p || !el) return;
    const focus = readerArchifyFocus(p, s), viewer = el.querySelector('iframe')?.contentWindow?.Archify;
    if (viewer?.focus) {
      if (s.path === 'all' && !s.stage) viewer.focus.clear({ updateUrl: false, preserveView: true });
      else viewer.focus.setMany(focus.node_ids, { toggle: false, mode: 'selection', hideChip: true, updateUrl: false });
    }
    el.querySelectorAll('[data-archify-path]').forEach(b => b.setAttribute('aria-pressed', String(!s.stage && b.dataset.archifyPath === s.path)));
    el.querySelectorAll('[data-archify-stage]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.archifyStage === s.stage)));
    el.querySelector('#archify-focus-status').textContent = `当前聚焦 ${focus.node_ids.length} 个定义、${focus.edge_ids.length} 条静态关系；运行执行状态未知。`;
  }
  async function handleClick(el, id) {
    if (el.dataset.archifyPath || el.dataset.archifyStage) {
      const s = state(id); if (!s.result) return true;
      s.path = el.dataset.archifyPath ?? 'all'; s.stage = el.dataset.archifyStage ?? null; applyFocus(id); return true;
    }
    if (el.dataset.archifyNode || el.dataset.archifyEdge) {
      await select(id, { kind: el.dataset.archifyNode ? 'node' : 'edge', id: el.dataset.archifyNode ?? el.dataset.archifyEdge }); return true;
    }
    const action = el.dataset.archifyAction; if (!action) return false;
    const s = state(id);
    if (action === 'prepare') { await prepare(id); return true; }
    if (action === 'close') { s.open = false; s.request++; onChange(); return true; }
    if (!s.result) return true;
    const base = 'archify-' + id.replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + data.snapshot.slice(0, 12);
    try {
      if (action === 'html') {
        const response = await fetch(s.result.artifactUrl); if (!response.ok) throw new Error('无法读取已交付 HTML。');
        const html = await response.text();
        if (await readerArchifyDigest(html) !== s.result.receipt.artifact.sha256 || new TextEncoder().encode(html).length !== s.result.receipt.artifact.bytes) throw new Error('HTML 与交付收据摘要不匹配，已停止下载。');
        download(html, base + '.html', 'text/html');
      } else {
        const value = action === 'json' ? s.result.projection.spec : action === 'receipt' ? s.result.receipt : s.result.projection;
        download(JSON.stringify(value, null, 2) + '\n', base + '-' + action + '.json', 'application/json');
      }
    } catch (error) { showError(id, error); }
    return true;
  }
  function wireFrame(id) {
    const frame = root(id)?.querySelector('iframe'); if (!frame) return;
    const wire = () => {
      const doc = frame.contentDocument; if (!doc || wired.has(doc)) return; wired.add(doc);
      const activate = event => {
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        const edge = event.target.closest?.('[data-relationship-id],[data-edge-id]');
        const node = event.target.closest?.('[data-node-id]'), p = state(id).result.projection;
        const edgeId = edge?.dataset.relationshipId ?? edge?.dataset.edgeId;
        if (edgeId && p.edges.some(e => e.id === edgeId)) void select(id, { kind: 'edge', id: edgeId });
        else if (node && p.nodes.some(n => n.id === node.dataset.nodeId)) void select(id, { kind: 'node', id: node.dataset.nodeId });
      };
      doc.addEventListener('click', activate, true); doc.addEventListener('keydown', activate, true);
      // Fit the outer iframe to normal document flow; never clip the diagram into an inner scroller.
      const fit = () => {
        if (!frame.isConnected) return;
        const bodyStyle = frame.contentWindow.getComputedStyle(doc.body);
        const height = Math.ceil(doc.querySelector('.container').getBoundingClientRect().bottom - doc.body.getBoundingClientRect().top + parseFloat(bodyStyle.paddingBottom) + 4);
        if (Math.abs(frame.getBoundingClientRect().height - height) > 2) frame.style.height = height + 'px';
      };
      const diagram = doc.querySelector('.diagram-container');
      diagram.tabIndex = 0; diagram.setAttribute('role', 'region'); diagram.setAttribute('aria-label', 'Archify 图面，窄屏可用左右方向键滚动');
      const observer = new ResizeObserver(fit); observer.observe(doc.querySelector('.container'));
      frame.addEventListener('load', () => observer.disconnect(), { once: true });
      fit(); applyFocus(id);
      const selected = state(id).stage || state(id).path !== 'all' ? null : state(id).selected;
      if (selected?.kind === 'node') frame.contentWindow.Archify?.focus?.set(selected.id, { toggle: false, updateUrl: false });
      if (selected?.kind === 'edge') frame.contentWindow.Archify?.focus?.inspectRelationshipById(selected.id, { toggle: false, updateUrl: false });
    };
    frame.addEventListener('load', wire, { once: true });
    if (frame.contentDocument?.readyState === 'complete' && frame.contentWindow?.Archify) wire();
  }
  return { view, handleClick, wireFrame, isOpen: id => state(id).open && Boolean(state(id).result?.artifactUrl) };
}
