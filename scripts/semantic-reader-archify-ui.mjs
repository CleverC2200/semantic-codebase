import { createArchifyProjection, readerArchifyDigest } from './semantic-reader-archify.mjs';

export function createReaderArchifyPanel(data, loader, { onChange, onLoaded, announce }) {
  const states = new Map();
  const E = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const state = id => { if (!states.has(id)) states.set(id, { busy: false, error: '', result: null, open: false, selected: null }); return states.get(id); };
  const download = (text, name, type) => {
    const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function prepare(id) {
    const s = state(id); if (s.busy) return;
    s.busy = true; s.error = ''; onChange();
    try {
      let result;
      if (data.archifyService) {
        const response = await fetch(data.archifyService.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reader-Token': data.archifyService.token }, body: JSON.stringify({ mainline: id }) });
        result = await response.json(); if (!response.ok) throw new Error(result.error ?? '本地图生成失败。');
        if (result.projection?.binding.snapshot !== data.snapshot || result.projection.binding.revision !== data.revision || result.projection.binding.mainline_id !== id || result.receipt?.input_sha256 !== result.projection.input_sha256) throw new Error('生成结果版本不匹配。');
      } else {
        const line = data.mainlines.find(m => m.id === id), keys = [...new Set(line.stages.flatMap(s => s.keys))];
        for (const key of keys) await loader.definition(key);
        const ids = new Set();
        const refs = value => { if (!value || typeof value !== 'object') return; for (const [key, item] of Object.entries(value)) { if (key.endsWith('evidence_id') && typeof item === 'string') ids.add(item); if (key.endsWith('evidence_ids') && Array.isArray(item)) item.forEach(id => ids.add(id)); if (item && typeof item === 'object') refs(item); } };
        for (const d of data.definitions.filter(d => keys.includes(d.definition_key))) { await loader.source(d.file_path); refs(d); }
        for (const f of data.facts.filter(f => f.kind === 'call_target' && keys.includes(f.subject?.definition_key))) refs(f);
        const evidence = await loader.evidence([...ids]);
        for (const path of new Set(evidence.map(e => e.file_path))) await loader.source(path);
        onLoaded(); result = { projection: await createArchifyProjection(data, id), receipt: null };
      }
      s.result = result; s.open = true; s.selected = null; announce('已核对当前主线范围，可预览或导出。');
    } catch (error) { s.error = error.message; announce(error.message); }
    finally { s.busy = false; onChange(); }
  }
  function selectedHtml(s) {
    const p = s.result.projection, node = p.nodes.find(n => n.id === s.selected);
    if (!node) return '<p>选择图中节点，核对声明与 Evidence；也可使用下方函数入口。</p>';
    return `<h3>${E(node.qualified_name)}</h3><p>${E(node.file_path)} · L${node.line}–${node.end_line}</p><p class="muted">Definition ${E(node.definition_key)}<br>Snapshot ${E(p.binding.snapshot)}<br>revision ${E(p.binding.revision)}</p><button data-enter-file="${E(node.file_path)}" data-enter-key="${E(node.definition_key)}">回到此定义源码</button><details><summary>声明与调用依据</summary><pre>${E(JSON.stringify({ evidence: node.evidence_ids.map(id => p.evidence[id]), calls: p.edges.filter(e => e.from === node.id || e.to === node.id), coverage: p.coverage }, null, 2))}</pre></details>`;
  }
  function view(id) {
    const s = state(id), p = s.result?.projection;
    return `<section class="archify-reader" aria-label="Archify 展示"><div class="mainline-actions"><button data-archify-action="prepare" ${s.busy ? 'disabled' : ''}>${s.busy ? '正在核对并生成…' : data.archifyService ? '预览 Archify 图' : '准备 Archify 图规格'}</button>${s.open ? '<button data-archify-action="close">收起展示图</button>' : ''}</div><p role="alert" class="archify-error">${E(s.error)}</p>${p && s.open ? `<div class="archify-scope"><p>${p.nodes.length} 个定义 · ${p.edges.length} 条关系 · ${p.unknowns.length} 项边界 · Coverage ${E(p.coverage.status)}</p><p class="muted">Snapshot ${E(p.binding.snapshot)}<br>revision ${E(p.binding.revision)} · ${E(p.binding.projector_version)}</p><details><summary>导出范围与未知项</summary><p>只包含此主线的源码定位和证据元数据；阶段为推断说明，静态调用不代表执行顺序。</p><pre>${E(JSON.stringify(p.unknowns, null, 2))}</pre></details><div class="mainline-actions"><button data-archify-action="json">下载 Archify JSON</button><button data-archify-action="proof">下载投影证据</button>${s.result.receipt ? '<button data-archify-action="html">下载离线 HTML</button><button data-archify-action="receipt">下载交付收据</button>' : '<p>此页面可导出规格；HTML 预览请使用本地 Archify 阅读入口。</p>'}</div></div>${s.result.artifactUrl ? `<iframe id="archify-reader-frame" title="${E(data.mainlines.find(m => m.id === id).title)} · Archify 展示图" src="${E(s.result.artifactUrl)}"></iframe>` : ''}<div class="archify-source" id="archify-reader-source" aria-label="图节点来源">${selectedHtml(s)}</div><details><summary>全部定义的源码入口</summary><div class="links">${p.nodes.map(n => `<button data-enter-file="${E(n.file_path)}" data-enter-key="${E(n.definition_key)}">${E(n.qualified_name)} · L${n.line}</button>`).join('')}</div></details>` : ''}</section>`;
  }
  async function handleClick(el, id) {
    const action = el.dataset.archifyAction; if (!action) return false;
    const s = state(id);
    if (action === 'prepare') { await prepare(id); return true; }
    if (action === 'close') { s.open = false; onChange(); return true; }
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
    } catch (error) { s.error = error.message; onChange(); }
    return true;
  }
  function wireFrame(id) {
    const frame = document.getElementById('archify-reader-frame'); if (!frame) return;
    frame.addEventListener('load', () => {
      const select = event => {
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        const node = event.target.closest?.('[data-node-id]'), s = state(id);
        if (!node || !s.result.projection.nodes.some(n => n.id === node.dataset.nodeId)) return;
        s.selected = node.dataset.nodeId;
        const panel = document.getElementById('archify-reader-source'); if (panel) panel.innerHTML = selectedHtml(s);
        announce('已选择图节点，可在图下方核对来源并回到源码。');
      };
      frame.contentDocument.addEventListener('click', select);
      frame.contentDocument.addEventListener('keydown', select);
    }, { once: true });
  }
  return { view, handleClick, wireFrame, isOpen: id => state(id).open && Boolean(state(id).result?.artifactUrl) };
}
