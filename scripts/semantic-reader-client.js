(() => {
  const D = JSON.parse(document.getElementById('reader-data').textContent);
  const $ = id => document.getElementById(id);
  const E = x => String(x ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const loader = createReaderAssetLoader(D);
  const archifyPanel = createReaderArchifyPanel(D, loader, { onChange: () => { savePosition(); if (S.context === 'mainline') render(); }, onLoaded: rebuildAnalysis, announce });
  let M = createReaderGraphModel(D), defs = M.definitions, functions = M.functions, calls = M.calls;
  const own = key => D.facts.filter(f => f.subject.definition_key === key);
  const label = key => defs.get(key)?.qualified_name ?? '未解析目标';
  const fnLink = key => `<button data-fn="${E(key)}">${E(label(key))}</button>`;
  let capabilityStorage = null, capabilityStorageError = '';
  try { capabilityStorage = window.localStorage; } catch { capabilityStorageError = '浏览器禁止本机存储，归属决定暂不能保存。'; }
  let capabilities;
  try { capabilities = createReaderCapabilityModel(D, { storage: capabilityStorage }); }
  catch { capabilities = createReaderCapabilityModel(D); capabilityStorage = null; capabilityStorageError = '本机决定记录无法读取；已保留原记录，暂时只读。'; }
  const capabilityStatus = c => ({ candidate: '候选', confirmed: '本机已确认', needs_review: '需复核' }[c.status]);
  let risk = createReaderRiskModel(D, { capabilities: () => capabilities });
  const mainlines = D.mainlines ?? [];
  const searchIndex = readerSearchIndex(D);
  const initialFile = D.initialFile ?? D.files.find(f => f.path.endsWith('/parseUtil.ts'))?.path ?? D.files[0]?.path;
  let S = { context: D.archifyService && mainlines.some(m => m.available) ? 'mainline' : D.overview ? 'overview' : 'file', file: initialFile, mode: 'text', reader: null, fn: null, mainline: (D.archifyService ? mainlines.find(m => m.available) : mainlines[0])?.id, stage: null, detail: null, node: null, edge: null };
  const comparison = { base: null, target: D, pairs: [], result: null, selected: null, error: '', verificationRecords: [] };
  const requirementPanel = createReaderRequirementPanel(D, { storage: capabilityStorage, beforeReview: prepareRequirements, onChange: () => { if (S.context === 'requirements') render(); } });
  let wrapSource = true, detailNavigation = null, graph = null, graphCacheKey = '', graphSelection = null;
  const openFiles = new Set([initialFile]), expanded = new Set([D.sourceRoot, ...(initialFile ?? '').split('/').slice(0,-1).map((_,i)=>(initialFile ?? '').split('/').slice(0,i+1).join('/'))]);
  const mainlineSelections = new Map();
  const filePreferences = new Map(), bookmarks = new Map(), returnContexts = [];
  let activeBookmark = '', inspectorWidth = 440;
  let loadGeneration = 0, retryLoad = null, analysisFacts = D.facts;
  function rebuildAnalysis() {
    if (analysisFacts === D.facts) return;
    analysisFacts = D.facts;
    M = createReaderGraphModel(D); defs = M.definitions; functions = M.functions; calls = M.calls;
    risk = createReaderRiskModel(D, { capabilities: () => capabilities }); graphCacheKey = ''; graph = null;
  }
  async function loadFor(action, retry) {
    const token = ++loadGeneration;
    const status = $('reader-load-state'); status.hidden = false; status.textContent = '正在加载并核对当前版本…';
    try {
      await action();
      if (token !== loadGeneration) return false;
      rebuildAnalysis(); status.hidden = true; retryLoad = null; return true;
    } catch (error) {
      if (token === loadGeneration) {
        retryLoad = retry;
        status.innerHTML = '资源未能加载或版本校验失败；当前阅读位置已保留。<button data-load-retry>重试</button>';
        announce(error.message);
      }
      return false;
    }
  }
  async function loadSource(path) {
    if (D.files.find(f => f.path === path)?.verified) await loader.source(path);
  }
  async function prepareRequirements(document) {
    if (!D.assetManifest) return;
    const reviews = document?.reviews ?? [];
    const ids = [...new Set(reviews.flatMap(r => r.evidenceIds ?? []))];
    // Missing old-version references remain review gaps; never substitute another source.
    const present = ids.filter(id => Object.hasOwn(D.evidence, id) || D.assetManifest.evidence[id.slice(0, 3)]);
    if (present.length) await loader.evidence(present, { allowMissing: true });
    const paths = new Set(reviews.flatMap(r => Object.keys(r.sourceDigests ?? {})));
    for (const id of present) if (D.evidence[id]) paths.add(D.evidence[id].file_path);
    for (const path of paths) if (D.files.some(f => f.path === path)) await loadSource(path);
  }
  const deferredAnalysis = key => `<p class="muted">本函数的分析尚未加载。</p><button data-load-definition="${E(key)}">加载函数分析</button>`;
  const deferredCalls = () => '<p class="muted">全局调用关系尚未加载，不能据此判断调用者或影响范围。</p><button data-load-calls>加载调用与影响</button>';
  const sourceVersion = file => file?.verified && typeof file.source === 'string' ? '源码版本已核对' : file?.verified ? '源码待加载核对' : '源码版本待复核';
  function preference(file = S.file) {
    if (!filePreferences.has(file)) filePreferences.set(file, { expanded: [], internal: null, mode: 'text', fn: null, focus: true, fileOrder: 'source' });
    return filePreferences.get(file);
  }
  const line = () => mainlines.find(m => m.id === S.mainline);
  const viewKey = () => S.context === 'requirements' ? 'requirements' : S.context === 'overview' ? 'project-overview' : S.context === 'comparison' ? 'comparison:' + (comparison.base?.snapshot ?? 'none') + ':' + comparison.target.snapshot + (comparison.focus ? ':' + comparison.focus.side + ':' + comparison.focus.key : '') : S.context === 'capability' ? 'capability:' + S.capability : S.context === 'mainline' ? 'mainline:' + S.mainline : S.file + ':' + (S.reader ?? 'overview') + ':' + S.mode + (S.mode === 'graph' ? ':' + Boolean(preference().rawControl) + ':' + (preference().internal ?? 'overview') : '');
  function savePosition() {
    if (!activeBookmark || !$('reading').getClientRects().length) return;
    const canvas = $('graph-canvas');
    const previous = bookmarks.get(activeBookmark) ?? {};
    bookmarks.set(activeBookmark, { ...previous, reading: $('reading').scrollTop,
      ...(canvas ? { left: canvas.scrollLeft, top: canvas.scrollTop, zoom: Number(canvas.dataset.zoom) } : {}) });
  }
  function restorePosition() {
    const saved = bookmarks.get(activeBookmark) ?? {};
    $('reading').scrollTop = saved.reading ?? 0;
    const canvas = $('graph-canvas');
    if (canvas) { canvas.scrollLeft = saved.left ?? 0; canvas.scrollTop = saved.top ?? 0; }
  }
  function rememberContext() { returnContexts.push({ context: S.context, capability: S.capability, file: S.file, mode: S.mode, reader: S.reader, fn: S.fn, mainline: S.mainline, flowPath: S.flowPath, stage: S.stage }); }
  function announce(text) { $('reader-status').textContent = text; }
  function revealFile(path) {
    openFiles.add(path); const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
  }
  async function enterFile(path, key = null, remember = true) {
    if (key) { return readFunction(key); }
    if (!await loadFor(() => loadSource(path), () => enterFile(path, key, remember))) return;
    savePosition();
    if (remember && (S.context !== 'file' || S.file !== path)) rememberContext();
    const pref = preference(path);
    S = { ...S, context: 'file', file: path, mode: pref.mode, reader: null, fn: key ?? pref.fn, detail: key ? 'fn' : null, node: null, edge: null };
    graphSelection = null; revealFile(path); closeNavigation(); render();
    announce('正在阅读 ' + path.split('/').pop());
  }
  function enterOverview() {
    loadGeneration++; $('reader-load-state').hidden = true;
    savePosition(); rememberContext();
    S = { ...S, context: 'overview', reader: null, fn: null, detail: null };
    closeNavigation(); render();
  }
  function overviewView() {
    const overview = readerProjectOverview(D);
    const entryButton = c => !c.entry ? `<p class="muted">${E(c.unavailable)}</p>` : c.entry.type === 'mainline' ? `<button data-mainline="${E(c.entry.key)}">阅读主线</button>` : c.entry.type === 'file' ? `<button data-file="${E(c.entry.key)}">阅读入口文件</button>` : `<button data-read-function="${E(c.entry.key)}">阅读入口函数</button>`;
    return `<section class="project-overview"><h1>${E(overview.title)}</h1><p class="lede">${E(overview.purpose || overview.reason)}</p><p class="source-status">阅读建议 · AI 推断 · 未验证</p><p class="muted">${overview.scope.files} 个文件 · ${overview.scope.definitions} 个定义 · ${E(overview.scope.languages.join(' / '))} · Coverage ${E(overview.scope.coverage)}</p><h2>从这里理解项目</h2><ol class="reading-route">${overview.capabilities.map(c => `<li><h3>${E(c.title)}</h3><p>${E(c.description)}</p><p class="muted">${E(c.reason)} · 能力候选</p>${entryButton(c)}</li>`).join('') || '<li>尚无有效的推荐入口，请从源码目录继续。</li>'}</ol>${overview.fallbackFile ? `<button data-file="${E(overview.fallbackFile)}">从源码目录开始</button>` : '<p>本次没有可阅读文件。</p>'}<h2>阅读范围</h2><p>${E(overview.boundary || '只展示此冻结范围；结构归属不等于完整业务理解。')}</p><details><summary>版本与来源</summary><p>Snapshot ${E(overview.scope.snapshot)}</p><p>推荐说明不改变事实，进入具体函数或主线后可核对源码。</p></details></section>`;
  }
  function enterRequirements() {
    savePosition(); rememberContext();
    S = { ...S, context: 'requirements', reader: null, fn: null, detail: null };
    closeNavigation(); render(); requirementPanel.open();
  }
  async function enterComparison() {
    if (!await loadFor(() => loader.all(), enterComparison)) return;
    comparison.focus = null;
    savePosition(); returnContexts.length = 0; S = { ...S, context: 'comparison', reader: null, fn: null, detail: null }; render();
  }
  function importedFactProof(fact, bundle) {
    return `<details><summary>核对 ${E(fact.kind)} 的 ${E(bundle.snapshot)} 依据</summary><p>导入的静态记录，未重新准入或执行。</p>${(fact.evidence_ids ?? []).map(id => {
      const e = bundle.evidence[id], file = bundle.files.find(f => f.path === e?.file_path);
      const excerpt = file?.verified && e?.span ? new TextDecoder().decode(new TextEncoder().encode(file.source).subarray(e.span.start_byte, e.span.end_byte)) : '源码不可用';
      return `<p>${E(e?.file_path)} · 字节 ${E(e?.span?.start_byte)}–${E(e?.span?.end_byte)} · ${E(id)}</p><pre>${E(excerpt)}</pre>`;
    }).join('')}</details>`;
  }
  function comparisonFunctionView() {
    const focus = comparison.focus, bundle = comparison[focus.side], model = createReaderGraphModel(bundle), d = model.definitions.get(focus.key);
    if (!d) return '<p>此版本中没有该定义。</p><button data-comparison-return>返回原比较</button>';
    const logic = model.logicGraph(d.definition_key), direct = model.functionCalls(d.definition_key), values = model.dataFlow(d.definition_key), impact = createReaderRiskModel(bundle).impact(d.definition_key);
    const ref = key => { const def = model.definitions.get(key); return def ? `<button data-comparison-function="${E(key)}" data-comparison-side="${E(focus.side)}">${E(def.qualified_name)}</button>` : '未解析目标'; };
    return `<button data-comparison-return>返回原比较</button><div class="breadcrumb">${E(focus.side === 'base' ? '基线' : '目标')} Snapshot ${E(bundle.snapshot)} / ${E(d.file_path)}</div><h1>${E(d.qualified_name)}</h1><p class="muted">仅阅读所选版本；导入的静态记录未重新准入，功能说明仍为未验证的展示。</p>${ioHtml(d, true)}<h2>关键逻辑</h2>${logic.nodes.map(n => `<article><strong>${E(n.title)}</strong><pre>${E(n.block?.source_excerpt ?? n.description)}</pre></article>`).join('') || '<p>未提取，保留源码与未知边界。</p>'}<p>${E(logic.unknowns?.join('、'))}</p><h2>直接调用与影响</h2><p>${impact.directCallers.length} 个直接调用者 · ${impact.directCallSites} 处位置；有界可达 ${impact.reached.length}，Coverage ${E(impact.coverage.status)}。</p>${direct.edges.map(edge => `<p>${ref(edge.from)} → ${ref(edge.to)} · ${edge.facts.length} 处位置</p>${edge.facts.map(f => importedFactProof(f, bundle)).join('')}`).join('') || '<p>没有已知直接调用；不代表没有影响。</p>'}<h2>关键数据与写入</h2>${values.routes.map(r => `<p>${E(r.from)} → ${E(r.to)}</p>`).join('')}${values.writes.map(f => `<p>${E(f.value.effect_kind)} · ${E(f.value.operation)}</p>${importedFactProof(f, bundle)}`).join('')}<p>${E(values.unknowns.join('、'))}</p><details open><summary>此版本源码</summary>${sourceHtml(bundle.files.find(f => f.path === d.file_path), d)}</details>`;
  }
  function comparisonView() {
    if (comparison.focus) return comparisonFunctionView();
    const result = comparison.result;
    const names = { added: '仅目标存在 · 对应待确认', removed: '仅基线存在 · 对应待确认', modified: '源码已变化', unchanged: '源码相同', source_unavailable: '源码不可用' };
    return `<h1>变更阅读</h1><p class="lede">明确比较版本，再核对变化。导入只在本机处理，不修改当前索引。</p><div class="comparison-inputs"><label>基线快照<input type="file" accept=".json,application/json" data-bundle-slot="base"></label><label>目标快照<input type="file" accept=".json,application/json" data-bundle-slot="target"></label></div><details class="details"><summary>导入本次验证记录</summary><p class="muted">记录须绑定仓库、基线、目标、定义和验证产物；导入记录不代表已重新执行验证。</p><input type="file" accept=".json,application/json" data-verification-records><p>已载入 ${comparison.verificationRecords.length} 条记录；仅使用适用于当前比较的条目。</p></details><div class="links"><button data-export-bundle>导出当前快照阅读包</button><button data-base-current>当前快照作为基线</button><button data-target-current>当前快照作为目标</button></div><p id="comparison-error" role="alert">${E(comparison.error)}</p><p class="breadcrumb">基线：${E(comparison.base?.snapshot ?? '尚未选择')}<br>目标：${E(comparison.target.snapshot)}</p><p class="muted">导入包只核对本地内容和引用一致性，不代表已重新执行语义准入或真实环境验收。</p>${result ? `<p>Coverage：基线 ${E(result.coverage.base?.status ?? 'unknown')} / 目标 ${E(result.coverage.target?.status ?? 'unknown')}</p><details class="details"><summary>文件变化 · ${result.files.filter(f => f.kind !== 'unchanged').length}</summary>${result.files.map(f => `<p>${E(f.path)} · ${E(f.kind)}</p>`).join('')}</details><details class="details"><summary>确认跨版本定义对应</summary><p class="muted">变化文件中的同名声明不会自动对应；请核对后明确选择。该对应仅用于本次阅读，不创造稳定 Definition 身份。</p><form id="definition-correspondence"><label>基线定义<select name="baseKey">${comparison.base.definitions.map(d => `<option value="${E(d.definition_key)}">${E(d.qualified_name)} · ${E(d.file_path)}</option>`).join('')}</select></label><label>目标定义<select name="targetKey">${comparison.target.definitions.map(d => `<option value="${E(d.definition_key)}">${E(d.qualified_name)} · ${E(d.file_path)}</option>`).join('')}</select></label><label>核对人<input name="actor" required maxlength="100"></label><label>对应理由<input name="reason" required maxlength="500"></label><button>添加对应</button><p id="correspondence-error" role="alert"></p></form>${comparison.pairs.length ? '<button data-clear-correspondences>清除本次人工对应</button>' : ''}</details><section class="change-list"><h2>定义变化</h2>${result.changes.filter(c => c.kind !== 'unchanged').map(c => `<article><button data-change="${E(c.id)}" aria-pressed="${comparison.selected === c.id}">${E(c.after?.qualified_name ?? c.before.qualified_name)}</button><p>${names[c.kind]} · ${E(c.after?.file_path ?? c.before.file_path)}</p></article>`).join('') || '<p>没有发现可展示的定义源码变化。</p>'}</section>${result.unknowns.length ? '<p class="muted">存在尚未确认的跨版本对应，新增／删除项不等于已确认业务行为变化。</p>' : ''}` : '<p class="empty">导入基线阅读包后，与当前目标比较。可先导出当前包，在后续 Snapshot 中作为基线使用。</p>'}`;
  }
  function changeBody(change) {
    const affected = change.after ? comparison.target : comparison.base, key = change.after?.definition_key ?? change.before.definition_key;
    const review = reviewReaderChange(change, comparison.base, comparison.target, { impact: createReaderRiskModel(affected).impact(key), verificationRecords: comparison.verificationRecords });
    const behavior = review.behavior;
    const labels = { unknown: '对应或源码不完整', unchanged: '源码相同', comments_or_spacing_only: '支持范围内仅注释或空白变化', supported_fact_changes: '发现可核对的静态变化', behavior_unknown: '实现已变，行为影响待核查' };
    const kinds = { contract: '契约', conditions: '条件与循环', returns: '返回与异常', writes: '写入与副作用' };
    const contract = createReaderRiskModel(affected).contractImpact(key);
    const sensitivity = change.after ? createReaderRiskModel(comparison.target).importance(change.after.definition_key) : createReaderRiskModel(comparison.base).importance(change.before.definition_key);
    return `<h2>${E(change.after?.qualified_name ?? change.before.qualified_name)}</h2><p class="muted">对应依据：${E(change.matching.kind)}${change.matching.actor ? ' · ' + E(change.matching.actor) + ' · ' + E(change.matching.reason) : ''}</p><h3>本次变化</h3><p>${labels[behavior.classification]}</p>${sensitivity.sensitivity.length ? `<p>长期重要性：${sensitivity.sensitivity.map(x => E(x.label) + (x.status === 'confirmed' ? ' · 已确认' : ' · 待核实')).join('、')}</p>` : ''}${behavior.items.map(item => `<section class="call-detail"><h3>${kinds[item.kind]}</h3><p class="muted">静态事实差异；实际行为仍需验证。</p><strong>之前</strong><pre>${E(JSON.stringify(item.before, null, 2))}</pre><strong>现在</strong><pre>${E(JSON.stringify(item.after, null, 2))}</pre>${item.beforeFacts.map(f => importedFactProof(f, comparison.base)).join('')}${item.afterFacts.map(f => importedFactProof(f, comparison.target)).join('')}</section>`).join('')}<h3>已知调用影响</h3><p>${review.impact?.directCallers.length ?? 0} 个直接调用者 · ${review.impact?.reached.length ?? 0} 个预算内可达定义；静态关联不等于行为已改变。</p><details><summary>核对调用路径</summary>${(review.impact?.paths ?? []).map(p => `<p>${p.keys.map(k => E(affected.definitions.find(d => d.definition_key === k)?.qualified_name ?? k)).join(' → ')}</p>${p.facts.map(f => `<pre>${E(JSON.stringify(f, null, 2))}</pre>`).join('')}`).join('')}</details><p class="muted">${E(review.impact?.completeness.status ?? 'unknown')} · Coverage ${E(review.impact?.coverage.status ?? 'unknown')}；非调用依赖未覆盖。</p><h3>公共契约依赖 · 继承</h3><p>已知派生定义 ${contract.reached.length} 个 · ${E(contract.completeness.status)}</p>${contract.paths.map(p => `<details><summary>${p.keys.map(k => E(affected.definitions.find(d => d.definition_key === k)?.qualified_name ?? k)).join(' → ')}</summary>${p.relations.map(r => `<p>INHERITS · Snapshot ${E(r.snapshot_id)}</p>${r.evidence_ids.map(id => { const e = affected.evidence[id]; return `<p>${E(e?.file_path)} · 字节 ${E(e?.span?.start_byte ?? '?')}–${E(e?.span?.end_byte ?? '?')}</p>`; }).join('')}`).join('')}</details>`).join('')}<p class="muted">只覆盖有证据的 INHERITS，不代表调用顺序；数据库、配置和事件依赖未覆盖。</p><h3>验证记录</h3>${review.verification.map(r => `<p>${E(r.kind)} · ${E(r.status)}<br>${E(r.summary)}<br>产物：${E(r.artifact)}</p>`).join('') || '<p>没有适用于当前比较的验证记录。</p>'}<p class="muted">${review.runtimeObserved ? '存在对应执行观测，不等于完整业务验收。' : '尚无对应真实执行证据。'} 导入记录未在本次阅读中重新执行。</p>${review.gaps.filter(g => g.startsWith('verification_missing:')).map(g => `<p>缺少对应验证：${E(kinds[g.split(':')[1]])}</p>`).join('')}<h3>优先核查</h3><ul>${behavior.checks.map(x => `<li>${E(x)}</li>`).join('')}</ul><h3>之前 · ${E(comparison.base.snapshot)}</h3><p class="breadcrumb">${E(change.before?.file_path ?? '无对应定义')}</p><pre>${E(change.beforeSource ?? '没有可核对的基线源码')}</pre><h3>现在 · ${E(comparison.target.snapshot)}</h3><p class="breadcrumb">${E(change.after?.file_path ?? '无对应定义')}</p><pre>${E(change.afterSource ?? '没有可核对的目标源码')}</pre>${change.before ? `<button data-comparison-function="${E(change.before.definition_key)}" data-comparison-side="base">阅读基线函数</button>` : ''}${change.after ? `<button data-comparison-function="${E(change.after.definition_key)}" data-comparison-side="target">阅读目标函数</button>` : ''}`;
  }
  function enterCapability(id, remember = false) {
    if (id !== 'unassigned' && !capabilities.get(id)) return;
    savePosition(); if (remember) rememberContext(); else returnContexts.length = 0;
    S = { ...S, context: 'capability', capability: id, reader: null, fn: null, detail: null };
    document.querySelector('.sidebar').dataset.navigation = 'business'; render();
    announce('正在阅读能力：' + (capabilities.get(id)?.title ?? '待归类'));
  }
  function capabilityMenu() {
    function branch(parent = null) { return capabilities.children(parent).map(c => `<li><button data-capability="${E(c.id)}" aria-current="${S.context === 'capability' && S.capability === c.id ? 'page' : 'false'}">${E(c.title)}<small>${c.available ? capabilityStatus(c) : '待复核'}</small></button>${capabilities.children(c.id).length ? `<details ${S.capability === c.id || capabilities.ancestors(S.capability).some(a=>a.id===c.id) ? 'open' : ''}><summary>展开子分组 · ${capabilities.children(c.id).length}</summary><ul>${branch(c.id)}</ul></details>` : ''}</li>`).join(''); }
    $('capability-menu').innerHTML = `<ul class="capability-tree">${branch()}</ul><button data-capability="unassigned">待归类 · ${capabilities.unassigned().length}</button>`;
    document.querySelectorAll('[data-navigation]').forEach(b => { if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.navigation === document.querySelector('.sidebar').dataset.navigation)); });
  }
  function capabilityDecisionForm(c) {
    const last = capabilities.history(c.id).at(-1);
    return `<details class="details"><summary>确认或调整阅读归属</summary><p class="muted">只保存到当前浏览器；不改写 Snapshot，也不替代运行能力注册表。换版本后需复核。</p>${capabilityStorageError ? `<p role="alert">${E(capabilityStorageError)}</p>` : `<form id="capability-decision"><label>上级能力<select name="parent"><option value="">顶层</option>${capabilities.list().filter(p => p.id !== c.id && !capabilities.ancestors(p.id).some(a => a.id === c.id)).map(p => `<option value="${E(p.id)}" ${p.id === c.parent ? 'selected' : ''}>${E(p.title)}</option>`).join('')}</select></label><label>确认人<input name="actor" required maxlength="100" value="${E(last?.actor ?? '')}"></label><label>理由<input name="reason" required maxlength="500"></label><button name="action" value="confirm">确认归属</button>${last ? '<button name="action" value="revoke">撤销确认</button>' : ''}<p id="decision-error" role="alert"></p></form>`}<details><summary>决定记录 · ${capabilities.history(c.id).length}</summary>${capabilities.history(c.id).map(e => `<p>v${e.version} · ${E(e.actor)} · ${e.action === 'revoke' ? '撤销' : '确认'}<br>${E(e.reason)}<br>Snapshot：${E(e.snapshot)}</p>`).join('')}</details></details>`;
  }
  function capabilityImplementations(keys) {
    const groups = new Map();
    for (const key of keys) { const d = defs.get(key); if (!d) continue; if (!groups.has(d.file_path)) groups.set(d.file_path, []); groups.get(d.file_path).push(d); }
    return `<div class="capability-implementations">${[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([path, entries]) => `<details class="details"><summary>${E(path)} · ${entries.length} 个定义</summary><button data-file="${E(path)}">阅读文件</button><ul>${entries.sort((a,b)=>(a.line??0)-(b.line??0)).map(d=>`<li>${fnLink(d.definition_key)} <span class="muted">L${d.line ?? '?'} · ${E(d.kind ?? d.definition_kind ?? '定义')}</span></li>`).join('')}</ul></details>`).join('')}</div>`;
  }
  function capabilityView() {
    const c = capabilities.get(S.capability), keys = c ? capabilities.members(c.id) : capabilities.unassigned();
    if (!c) return `<h1>待归类</h1>${groupingSummary()}<p>${keys.length ? `${keys.length} 个定义尚未关联业务或支撑模块，按文件展开核对。` : '当前分析范围内的定义均已有模块归属候选。具体业务含义和归属仍待核验。'}</p>${D.grouping?.unassigned?.length ? `<details class="details"><summary>未归类原因</summary>${D.grouping.unassigned.map(item=>`<p>${fnLink(item.definition_key)} · ${E(item.reason)}</p>`).join('')}</details>` : ''}${capabilityImplementations(keys)}`;
    return `<nav class="object-breadcrumb" aria-label="业务层级">${capabilities.ancestors(c.id).map(p => `<button data-capability="${E(p.id)}">${E(p.title)}</button><span>›</span>`).join('')}${E(c.title)}</nav><h1>${E(c.title)}</h1><p class="lede">${E(c.description)}</p><p class="muted">${c.available ? capabilityStatus(c) + ' · 确认仅针对阅读归属' : '来源版本失配，归属待复核；不展示过期映射。'}</p>${groupingReasons(c)}<section class="capability-list">${capabilities.children(c.id).map(child => `<article><button data-capability="${E(child.id)}">${E(child.title)}</button><p>${E(child.description)}</p></article>`).join('')}</section>${c.available && c.mainlines.length ? `<h2>可以完成哪些事</h2><section class="capability-list">${c.mainlines.map(id => { const m = mainlines.find(l => l.id === id); return `<article><button data-mainline="${E(id)}">${E(m.title)}</button><p>${E(m.purpose)}</p></article>`; }).join('')}</section>` : ''}${c.uses.length ? `<h3>协作能力 · 候选</h3><div class="links">${c.uses.map(id => `<button data-capability="${E(id)}">${E(capabilities.get(id).title)}</button>`).join('')}</div>` : ''}<details class="details"><summary>关联实现 · ${keys.length}</summary>${capabilityImplementations(keys)}</details>${capabilityDecisionForm(c)}<details class="explanation-origin"><summary>版本与来源</summary><p>Snapshot：${E(c.snapshot)}</p>${Object.entries(c.source_digests).map(([p,h]) => `<p>${E(p)}<br>${E(h)}</p>`).join('')}</details>`;
  }
  function groupingSummary() {
    const g = D.grouping; if (!g) return '';
    return `<section aria-label="自动分组范围"><p>模块归属 ${g.coverage.structural.mapped} / ${g.coverage.structural.total} · ${E(g.coverage.structural.status)}；业务解释：${E(g.coverage.business.status)}</p><p class="muted">自动分组仅是阅读候选；模块覆盖不代表语义理解。策略 ${E(g.strategy)}，复用冻结分析。</p><details class="details"><summary>预算与未覆盖范围 · ${E(g.status)}</summary><p>定义上限 ${g.limits.maxDefinitions}，关联上限 ${g.limits.maxLinks}，建议上限 ${g.limits.maxProposals}。</p><p>未处理关联 ${g.truncated_links}；未展示建议 ${g.truncated_proposals}；未知关联 ${g.unknown_links.length}；人工配置 ${g.manual_mapping_count} 项（不计自动覆盖）。完整明细保存在 reader-data.json。</p>${Object.entries(g.unknown_links.reduce((counts,l)=>(counts[l.reason]=(counts[l.reason]??0)+1,counts),{})).map(([r,n])=>`<p>${E(r)} · ${n}</p>`).join('')}</details><details class="details"><summary>已移除候选的决定历史 · ${capabilities.orphanedHistory().length}</summary>${capabilities.orphanedHistory().map(e=>`<p>${E(e.id)} · v${e.version} · ${E(e.actor)} · ${E(e.action)}<br>${E(e.reason)}<br>Snapshot ${E(e.snapshot)}</p>`).join('')}</details></section>`;
  }
  function groupingReasons(c) {
    if (c.origin !== 'automatic') return '<p class="muted">人工配置的阅读映射 · llm_inferred · 未验证；不计入自动生成验收。</p>';
    const incoming = (D.grouping?.links ?? []).filter(l=>l.to===c.id && l.from!==c.id);
    const names = { structural_module: '结构模块', structural_root: '结构组织', structural_directory: '目录组织', business_candidate: '业务归属建议', support_candidate: '支撑实现建议', proposal_root: '职责建议' };
    return `${groupingSummary()}${incoming.length ? `<details class="details"><summary>使用此实现 · ${incoming.length} 条关联</summary><p>最多展示 50 条；完整关联见 reader-data.json。</p>${incoming.slice(0,50).map(l=>`<p><button data-capability="${E(l.from)}">${E(capabilities.get(l.from)?.title ?? l.from)}</button> · ${E(l.kind)} · ${E(l.basis)}</p><div class="links">${l.evidence_ids.slice(0,20).map(eid=>`<button data-group-evidence="${E(eid)}">${E(D.evidence[eid]?.file_path)} · L${E(D.evidence[eid]?.line ?? '?')}</button>`).join('')}</div>`).join('')}</details>` : ''}<p>${E(names[c.category] ?? '候选')} · ${E(c.basis)} · 自动依据未验证，归属状态见上方</p>${c.reasons?.length ? `<details class="details"><summary>分组依据 · ${c.reasons.length}</summary><p class="muted">最多展示 50 条依据，每条 20 处证据；完整引用见 reader-data.json。</p>${c.reasons.slice(0,50).map(r=>`<p>${E(r.description)} <small>${E(r.rule)}</small></p><div class="links">${r.evidence_ids.slice(0,20).map(eid=>`<button data-group-evidence="${E(eid)}">${E(D.evidence[eid]?.file_path)} · L${E(D.evidence[eid]?.line ?? '?')}</button>`).join('')}</div>`).join('')}</details>` : ''}`;
  }
  function enterMainline(id, fromReference = false) {
    if (!mainlines.find(m => m.id === id)?.available) return;
    savePosition(); if (fromReference) rememberContext(); else returnContexts.length = 0;
    S = { ...S, context: 'mainline', reader: null, mainline: id, flowPath: 'all', stage: mainlineSelections.get(id) ?? null, detail: null, node: null, edge: null };
    graphSelection = S.stage; closeNavigation(); render(); announce('正在阅读主线：' + line().title);
  }
  async function changeMode(mode) {
    if (!await loadFor(async () => {
      if (mode === 'calls' || (mode === 'graph' && !S.reader)) await loader.calls();
      if (mode === 'graph' && S.reader) await loader.definition(S.reader);
    }, () => changeMode(mode))) return;
    savePosition(); S.mode = mode;
    preference().internal = mode === 'graph' ? S.reader : null;
    if (!S.reader) preference().mode = mode;
    S.detail = S.reader && window.innerWidth > 1180 ? 'fn' : null;
    S.fn = S.reader ?? preference().fn;
    graphSelection = null; render();
  }
  async function readFunction(key) {
    if (!await loadFor(() => loadSource(defs.get(key)?.file_path), () => readFunction(key))) return;
    const d = defs.get(key); if (!d || !['function', 'method'].includes(d.kind)) return;
    savePosition();
    if (S.context !== 'file' || (S.mode === 'graph' && !S.reader) || S.file !== d.file_path) rememberContext();
    const same = S.reader === key;
    S = { ...S, context: 'file', file: d.file_path, reader: key, fn: key, mode: same ? S.mode : 'text', detail: window.innerWidth > 1180 ? 'fn' : null, node: null, edge: null };
    preference().fn = key; preference().internal = S.mode === 'graph' ? key : null;
    graphSelection = null; revealFile(d.file_path); closeNavigation(); render();
    $('inspector').scrollTop = 0;
    const heading = $('center').querySelector('h1'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    announce('正在阅读函数 ' + d.qualified_name);
  }
  function closeNavigation() { document.querySelector('.sidebar').classList.remove('mobile-open'); }
  async function selectFunction(key) {
    if (!await loadFor(() => loadSource(defs.get(key)?.file_path), () => selectFunction(key))) return;
    const d = defs.get(key); if (!d) return;
    savePosition();
    S.fn = key; const callable = ['function', 'method'].includes(d.kind); S.detail = callable ? 'fn' : 'definition'; if (callable && d.file_path === S.file) preference().fn = key;
    const node = graph?.nodes.find(n => ['function', 'external'].includes(n.kind) && n.keys.includes(key));
    graphSelection = node?.id ?? null;
    render(false); $('inspector').scrollTop = 0; focusInspector(); announce('已打开 ' + label(key));
  }
  function focusInspector() { const heading = $('inspector').querySelector('h2'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
  function activeMembers() {
    if (S.context === 'mainline') return new Set((S.stage ? line()?.stages.filter(s => s.id === S.stage) : line()?.stages ?? []).flatMap(s => s.keys));
    if (!S.fn) return new Set();
    const keys = new Set([S.fn]);
    for (const f of calls) {
      if (f.subject.definition_key === S.fn && defs.has(f.value.target_definition_key)) keys.add(f.value.target_definition_key);
      if (f.value.target_definition_key === S.fn) keys.add(f.subject.definition_key);
    }
    return keys;
  }
  function fileIcon(name) {
    const extension = name.split('.').pop().toLowerCase();
    const types = { ts: ['TS', 'TypeScript', 'typescript'], tsx: ['TSX', 'TypeScript JSX', 'typescript'], js: ['JS', 'JavaScript', 'javascript'], jsx: ['JSX', 'JavaScript JSX', 'javascript'], json: ['{}', 'JSON', 'data'], md: ['MD', 'Markdown', 'document'], py: ['PY', 'Python', 'python'] };
    const [mark, type, tone] = types[extension] ?? [extension.slice(0, 3).toUpperCase(), extension.toUpperCase() + ' 文件', 'document'];
    return `<span class="file-type-icon ${tone}" title="${E(type)}" aria-label="${E(type)}">${E(mark)}</span>`;
  }
  function tree() {
    const sidebar = document.querySelector('.sidebar'), top = sidebar.scrollTop;
    const linked = activeMembers(), activeFiles = new Set([...linked].map(k => defs.get(k)?.file_path));
    const root = {};
    for (const file of D.files) {
      let node = root; const parts = (D.sourceRoot && file.path.startsWith(D.sourceRoot + '/') ? file.path.slice(D.sourceRoot.length + 1) : file.path).split('/');
      parts.forEach((part, i) => { node[part] ??= { children: {}, file: null }; if (i === parts.length - 1) node[part].file = file; node = node[part].children; });
    }
    function items(node, parent = D.sourceRoot ?? '') {
      return Object.entries(node).sort(([a, x], [b, y]) => Number(Boolean(x.file)) - Number(Boolean(y.file)) || a.localeCompare(b)).map(([name, item]) => {
        const path = item.file?.path ?? (parent ? parent + '/' + name : name);
        if (!item.file) return `<details class="directory" data-dir="${E(path)}" ${expanded.has(path) ? 'open' : ''}><summary><span class="tree-icon folder-icon" aria-hidden="true"></span>${E(name)}</summary><div class="directory-children">${items(item.children, path)}</div></details>`;
        const fns = functions.filter(d => d.file_path === path), selected = S.context === 'file' && S.file === path;
        const fileButton = `<button class="file-button ${selected ? 'selected' : ''}" data-file="${E(path)}" aria-current="${selected ? 'page' : 'false'}">${fileIcon(name)}<span>${E(name)}</span>${activeFiles.has(path) ? '<span class="route-dot" aria-label="相关文件"></span>' : ''}</button>`;
        if (!fns.length) return `<div class="tree-file leaf-file">${fileButton}</div>`;
        return `<details class="tree-file" data-file-group="${E(path)}" ${openFiles.has(path) ? 'open' : ''}><summary aria-label="展开或收起 ${E(name)} 的 ${fns.length} 个函数">${fileButton}<small>${fns.length}</small></summary><div class="tree-functions">${fns.map(d => `<button data-tree-fn="${E(d.definition_key)}" data-related="${E(d.definition_key)}" class="${(S.context === 'file' || S.detail === 'fn') && S.fn === d.definition_key ? 'selected' : ''} ${linked.has(d.definition_key) ? 'route-linked' : ''}"><span class="function-icon" aria-hidden="true">ƒ</span><span>${E(d.qualified_name)}</span>${linked.has(d.definition_key) ? '<span class="route-dot" aria-label="相关函数"></span>' : ''}</button>`).join('')}</div></details>`;
      }).join('');
    }
    $('tree').innerHTML = items(root); capabilityMenu();
    $('mainline-menu').innerHTML = mainlines.map(m => `<button data-mainline="${E(m.id)}" aria-pressed="${S.context === 'mainline' && S.mainline === m.id}" ${m.available ? '' : 'disabled'}><strong>${E(m.title)}</strong><small>${m.available ? '源码支持 · 说明待验证' : E(m.unavailable)}</small></button>`).join('') || '<p class="scope-note">此冻结包尚未整理可读主线；可用职责搜索或源码目录继续。</p>';
    document.querySelectorAll('[data-dir]').forEach(el => el.addEventListener('toggle', () => { if (el.isConnected) el.open ? expanded.add(el.dataset.dir) : expanded.delete(el.dataset.dir); }));
    document.querySelectorAll('[data-file-group]').forEach(el => el.addEventListener('toggle', () => { if (el.isConnected) el.open ? openFiles.add(el.dataset.fileGroup) : openFiles.delete(el.dataset.fileGroup); }));
    sidebar.scrollTop = top;
  }
  function summary(d){
    if(d.presentation)return {text:d.presentation.purpose,inferred:true};
    const fs=own(d.definition_key),cs=fs.filter(f=>f.kind==='call_target');
    const targets=[...new Set(cs.map(f=>f.value.target_definition_key?label(f.value.target_definition_key):f.value.call))].slice(0,3);
    const cf=fs.find(f=>f.kind==='control_flow');const ret=cf?.value.blocks.find(b=>b.kind==='return'&&b.source_excerpt);
    const effects=fs.filter(f=>f.kind==='effect'&&f.value.effect_kind==='state').map(f=>f.value.operation??f.value.effect_kind);
    const parts=[]; if(targets.length)parts.push('调用 '+targets.map(x=>x.length>65?x.slice(0,65)+'…':x).join('、'));
    if(ret)parts.push('返回逻辑：'+ret.source_excerpt.replace(/\s+/g,' ').slice(0,100));
    if(effects.length)parts.push('可能改变状态：'+effects.slice(0,2).join('、'));
    return {text:parts.join('；')||'暂无足够事实解释功能，请对照源码；功能待确认。',inferred:false};
  }

  function ioHtml(d, detailed=false){
    const sig=d.signature,p=d.presentation;
    const inputs=sig?.inputs??p?.inputs??null;
    const inputHtml=inputs?inputs.length?`<table class="io-table"><thead><tr><th>输入参数</th><th>类型与含义</th></tr></thead><tbody>${inputs.map(param=>{const explanation=p?.inputs?.find(x=>x.name===param.name)?.description;return `<tr><td><code>${E(param.name)}</code>${param.optional?' <span class="muted">可选</span>':''}</td><td>${param.type?`<code>${E(param.type)}</code>`:''}${explanation?`<p>${E(explanation)}</p>`:''}</td></tr>`;}).join('')}</tbody></table>`:'<p class="io-empty"><strong>输入</strong> 无显式参数；实例方法仍可能读取或修改 this。</p>':`<p class="muted">输入参数尚未结构化${d.rawType?.includes('...')?'（类型摘要可能截断）':''}，请对照完整声明。</p>${d.rawType?`<pre>${E(d.rawType)}</pre>`:''}`;
    return `<div class="io-block">${inputHtml}<div class="io-output"><strong>输出</strong><div class="io-output-content"><p>${E(p?.output??(sig?.output==='void'?'无返回值；是否存在副作用见处理逻辑。':sig?.output?'返回类型见下方声明。':'返回类型尚未提取，请查看函数声明。'))}</p>${sig?.output?`<span class="muted">类型声明：</span><code>${E(sig.output)}</code>`:''}</div></div></div>${detailed&&p?`${p.logic?`<h3>处理逻辑</h3><p>${E(p.logic)}</p>`:''}${p.example?`<h3>使用示例</h3><p class="example">${E(p.example)}</p><p class="muted">示例为解释性示意，未在本次预览中执行。</p>`:''}`:''}`;
  }
  function compactIo(d){const sig=d.signature,p=d.presentation;return `<dl class="io-summary"><div><dt>输入</dt><dd>${sig?sig.inputs.length?sig.inputs.map(i=>`<code>${E(i.name)}${i.optional?'?':''}${i.type?': '+E(i.type):''}</code>`).join('；'):'无显式参数':p?.inputs?.map(i=>E(i.name)).join('、')||'见详情中的声明'}</dd></div><div><dt>输出</dt><dd>${E(p?.output??sig?.output??'返回类型待补齐')}</dd></div></dl>`;}
  function fnRow(d){const sum=summary(d);return `<article class="function-row ${S.fn===d.definition_key?'selected':''}" data-related="${E(d.definition_key)}"><div class="row-header"><button class="fn-name" data-fn="${E(d.definition_key)}" aria-pressed="${S.fn===d.definition_key}">${E(d.qualified_name)}</button><span class="line">${d.line?'L'+d.line:'源码未核对'}</span></div><p class="function-purpose">${E(d.presentation?.purpose ?? '功能解释待补齐；可查看声明和源码。')}</p></article>`;}
  function fileView(){const file=D.files.find(f=>f.path===S.file);if(!file)return '<p class="empty">没有可查看文件。</p>';const fns=functions.filter(d=>d.file_path===S.file);
    let groups='';let previous;
    for(const row of M.fileCatalogue(S.file, preference().fileOrder)) {
      if (preference().fileOrder === 'group' && row.group !== previous) { groups += `<h3 class="group-label">${E(row.group)}</h3>`; previous = row.group; }
      groups += fnRow(defs.get(row.key));
    }

    const other=D.definitions.filter(d=>d.file_path===S.file&&!['function','method'].includes(d.kind));
    return `<div class="breadcrumb">${E(S.file)}</div><h1>${E(S.file.split('/').pop())}</h1>${file.presentation?`<section class="file-explanation"><p class="source-status">AI 推断 · 未验证 · ${E(sourceVersion(file))}</p><h2>这个文件负责什么</h2><p>${E(file.presentation.purpose)}</p><h2>在项目中的作用</h2><p>${E(file.presentation.role)}</p><p class="muted">${E(file.presentation.boundary)}</p></section>`:`<p class="lede">文件职责解释尚未生成；本文件提取到 ${fns.length} 个函数或方法。</p>`}<details class="explanation-origin"><summary>AI 解释与分析范围</summary><p>文件职责及已补齐的函数说明属于 llm_inferred、未验证的展示解释，绑定当前源码哈希。参数和返回类型来自已有编译器事实。未补齐的函数仍使用静态事实摘要；示例没有实际执行。</p><p>${file.verified?'本地源码与快照一致。':'本地源码缺失或与快照不符。'}整体分析覆盖为 partial。</p></details><div class="section-title"><h2>函数目录 · ${fns.length}</h2><label class="catalogue-order">顺序 <select id="file-order"><option value="source" ${preference().fileOrder !== 'group' ? 'selected' : ''}>源码顺序</option><option value="group" ${preference().fileOrder === 'group' ? 'selected' : ''}>源码归属分组</option></select></label></div>${groups||'<p class="empty">未抽取到函数；可查看下方文件源码及其他定义。</p>'}<details class="details"><summary>其他定义 · ${other.length}</summary>${other.map(d=>`<p><code>${E(d.qualified_name)}</code> · ${E(d.kind)}</p>`).join('')}</details><details class="details"><summary>完整文件源码</summary>${sourceHtml(file,null)}</details>`;
  }

  function dataFlowHtml(key) {
    if (!loader.hasDefinition(key)) return deferredAnalysis(key);
    const result = M.dataFlow(key);
    const proof = ids => ids.map(id => { const e = D.evidence[id]; return e ? `<span>${E(e.file_path)} · L${e.line ?? '?'} </span>` : '<span>证据缺失</span>'; }).join('');
    return `<details class="details"><summary>关键数据与写入 · ${E(label(key))}</summary><p class="muted">参数、局部值依赖与已有调用映射；${result.status}。状态写入单列，不推测参数必然写入某处。</p><h3>输入与返回</h3><p>${result.parameters.map(p => E(p.name)).join('、') || '参数来源未提取'}</p>${result.returns.map(r => `<p>${E(r.parameter)} → 返回值</p><p class="muted">${proof(r.evidence_ids)}</p>`).join('') || '<p class="muted">没有提取到参数至返回值的映射。</p>'}<h3>局部值变化</h3>${result.routes.filter(r => r.from !== r.to).map(r => `<p><code>${E(r.from)}</code> → <code>${E(r.to)}</code> · 静态值依赖</p><p class="muted">${proof(r.evidence_ids)}</p>`).join('') || '<p class="muted">没有可展示的跨变量传递。</p>'}<h3>调用中的数据交接</h3>${result.calls.map(f => `<section class="call-detail"><p>${E(label(f.value.target_definition_key))} · ${E(f.value.status)}</p>${(f.value.bindings ?? []).map(b => `<p><code>${E(b.argument_expression ?? '参数未提取')}</code> → <code>${E(b.parameter_name)}</code></p>`).join('')}${(f.value.mappings ?? []).map(m => `<p>${E(m.parameter_name)} → ${E(m.result_binding ?? '返回结果')} ${m.default_applicability ? ' · 默认值条件：' + E(m.default_applicability) : ''}</p>`).join('')}${factProof(f)}</section>`).join('') || '<p class="muted">跨函数传播未提取。</p>'}<h3>写入与外部副作用</h3>${result.writes.map(f => `<p>${E(f.value.effect_kind)} · ${E(f.value.operation)}</p>${factProof(f)}`).join('') || '<p class="muted">未提取到不代表没有副作用。</p>'}<p class="muted">${result.truncated ? '展示已截断。' : ''}${result.unknowns.map(E).join('、')}</p>${result.local ? factProof(result.local) : ''}</details>`;
  }
  function impactHtml(key) {
    if (!loader.hasCalls()) return deferredCalls();
    const result = risk.impact(key);
    return `<section class="impact-section"><h2>已知调用影响范围</h2><p>${result.directCallers.length} 个直接调用者 · ${result.directCallSites} 处调用位置${result.selfCallSites ? ' · ' + result.selfCallSites + ' 处自身递归' : ''}</p><p class="muted">向上最多 ${result.budget.maxDepth} 层，${result.budget.maxNodes} 个定义；${result.reached.length} 个已知可达调用者。${result.completeness.status === 'truncated' ? '结果已截断：' + result.completeness.reasons.map(E).join('、') : '预算内遍历完成'}，Coverage：${E(result.coverage.status)}。</p>${result.featureMappings?.length ? `<p>关联功能（非已确认行为影响）：${result.featureMappings.map(c => E(c.title) + ' · ' + E(c.status)).join('、')}</p>` : '<p class="muted">跨功能范围尚无足够映射。</p>'}<details class="details"><summary>核对影响路径 · ${result.paths.length}</summary>${result.paths.map(path => `<article class="call-detail"><div class="links">${path.keys.map(fnLink).join('<span>→</span>')}</div>${path.facts.map(factProof).join('')}</article>`).join('') || '<p>本次未提取到，不代表没有调用。</p>'}</details><p class="muted">仅调用关系范围；数据库、配置、事件、动态调用等可能未覆盖，不代表完整爆炸半径。</p></section>`;
  }
  function importanceHtml(key) {
    if (!loader.hasDefinition(key)) return deferredAnalysis(key);
    const result = risk.importance(key), reversible = { irreversible: '已标注难以恢复', reversible: '已标注可恢复', read_only: '已确认只读范围', state_write: '存在状态写入 · 恢复能力未知', external_unknown: '存在外部副作用 · 恢复能力未知', unknown: '写入与恢复边界待核查' };
    return `<div class="importance-summary">${result.sensitivity.slice(0, 2).map(s => `<span class="importance-tag">${E(s.label)} · ${s.status === 'confirmed' ? '已确认' : '待核实'}</span>`).join('')}<span>${reversible[result.reversibility]}</span></div><details class="explanation-origin"><summary>重要性依据与边界</summary>${result.sensitivity.map(s => `<p>${E(s.label)}：${E(s.reason ?? '')} · ${s.status === 'confirmed' ? '人工标注' : '候选'}${s.actor ? ' · ' + E(s.actor) : ''}</p>${(s.evidence_ids ?? []).map(id => { const e = D.evidence[id]; return e ? `<p>${E(e.file_path)} · L${e.line ?? '?'}</p>` : ''; }).join('')}`).join('')}${result.effects.map(f => `<p>${E(f.value.effect_kind)}：${E(f.value.operation)}</p>${factProof(f)}`).join('')}<p>${result.unknowns.map(E).join('、')}</p></details>`;
  }
  function functionView() {
    const d = defs.get(S.reader), sum = summary(d);
    const blocks = M.controls.find(f => f.subject.definition_key === S.reader)?.value.blocks.filter(b => !['entry', 'exit'].includes(b.kind)) ?? [];
    return `<article class="function-reading"><h1>${E(d.qualified_name)}</h1><p class="function-purpose">${E(sum.text)}</p><p class="muted">${d.line ? 'L' + d.line + '–' + d.endLine : '源码版本未核对'} · ${sum.inferred ? 'AI 说明 · 未验证' : '静态事实摘要 · 功能待补齐'} · ${E(sourceVersion(D.files.find(f => f.path === d.file_path)))}</p>${importanceHtml(d.definition_key)}${ioHtml(d, true)}${!d.presentation?.logic && blocks.length ? `<h3>处理逻辑 · 静态语句</h3>${blocks.map(b => `<pre>${E(b.source_excerpt ?? b.kind)}</pre>`).join('')}` : ''}${dataFlowHtml(d.definition_key)}<details class="explanation-origin"><summary>解释来源与完整声明</summary><p>功能、参数含义及示例如有 AI 说明，属于 llm_inferred、未验证的展示内容，绑定当前源码哈希；类型来自已有编译器事实。分析覆盖仍为 partial。</p>${d.rawType ? `<pre>${E(d.rawType)}</pre>` : ''}</details></article>`;
  }

  function sourceHtml(file,d,range){if(typeof file?.source!=='string')return '<p class="empty">本地源码缺失或哈希与快照不符，不能作为此版本的源码展示。</p>';const lines=file.source.split('\n');const start=d?.line?Math.max(1,d.line-2):1;const end=d?.endLine?Math.min(lines.length,d.endLine+2):lines.length;return `<div class="source ${wrapSource?'wrapped':''}" tabindex="0" aria-label="源码，使用左右方向键滚动">${lines.slice(start-1,end).map((line,i)=>{const n=start+i;return `<span class="source-line ${range?n>=range.start&&n<=range.end?'active':'':d&&n>=d.line&&n<=d.endLine?'active':''}"><b>${n}</b>${E(line)||' '}</span>`;}).join('')}</div>`;}
  function factProof(f){return `<details><summary>来源与证据</summary><span class="tag">${E(f.basis.kind)}</span>${f.evidence_ids.map(id=>{const e=D.evidence[id];return e?`<p class="muted">${E(e.file_path)} · ${e.line?'L'+e.line:'字节 '+e.span.start_byte+'–'+e.span.end_byte}</p>`:'';}).join('')}<details><summary>原始解析</summary><pre>${E(JSON.stringify(f,null,2))}</pre></details></details>`;}
  function currentGraph() {
    const pref = preference();
    const key = S.context === 'mainline' ? 'mainline:' + S.mainline : String(Boolean(pref.rawControl)) + ':' + S.file + ':' + S.mode + ':' + (S.mode === 'calls' ? S.reader : pref.internal ?? 'file') + ':' + pref.expanded.join(',');
    if (graphCacheKey === key && graph) return graph;
    graphCacheKey = key;
    if (S.context === 'mainline') {
      const m = line();
      graph = layoutReaderGraph({ type: 'mainline', nodes: (m?.stages ?? []).map(stage => ({ ...stage, facts: [] })),
        edges: (m?.edges ?? []).map(e => ({ ...e, kind: 'narrative', facts: [] })) });
    } else graph = layoutReaderGraph(S.mode === 'calls' && S.reader ? M.functionCalls(S.reader) : pref.internal ? (pref.rawControl ? M.controlGraph(pref.internal) : M.logicGraph(pref.internal)) : M.fileGraph(S.file, pref.expanded));
    return graph;
  }
  function edgeRoute(edge, index) {
    const a = graph.nodes.find(n => n.id === edge.from), b = graph.nodes.find(n => n.id === edge.to);
    if (!a || !b) return null;
    const x1 = a.x + a.width, y1 = a.y + a.height / 2, x2 = b.x, y2 = b.y + b.height / 2;
    if (x2 > x1) {
      const mid = x1 + (x2 - x1) * (0.35 + (index % 3) * 0.14);
      return { path: `M${x1} ${y1} H${mid} V${y2} H${x2}`, x: mid, y: (y1 + y2) / 2 - 16 };
    }
    const rail = Math.max(a.x + a.width, b.x + b.width) + 24 + (index % 4) * 10;
    if (a.id === b.id) return { path: `M${x1} ${y1} H${rail} V${a.y - 20} H${a.x + a.width / 2} V${a.y}`, x: rail, y: a.y - 30 };
    return { path: `M${x1} ${y1} H${rail} V${b.y - 22} H${b.x + b.width / 2} V${b.y}`, x: rail + 44, y: (y1 + b.y - 22) / 2 + ((index % 3) - 1) * 24 };
  }
  function selectedNode() {
    if (graphSelection && graph?.nodes.some(n => n.id === graphSelection)) return graphSelection;
    if (graph?.type === 'file' && S.fn) return graph.nodes.find(n => n.keys.includes(S.fn))?.id ?? null;
    return null;
  }
  function graphHtml() {
    currentGraph();
    if (!graph.nodes.length) {
      const others = D.definitions.filter(d => d.file_path === S.file);
      return `<section class="empty-state"><h2>${graph.type === 'control' ? '内部流程尚未提取' : '此文件未提取到函数'}</h2><p>${graph.type === 'control' ? '可对照源码阅读，不推测缺失的分支。' : others.length ? `本次提取到 ${others.length} 个其他定义。类型、导出和声明不强行画成函数流程。` : '当前分析没有可绘制的函数；不代表文件没有作用。'}</p><button data-view-source>查看文件阅读与源码</button></section>`;
    }
    if (graph.type === 'control' && !preference().rawControl) {
      const steps = readerBehaviorSteps(D, graph.root, M), byId = new Map(steps.nodes.map((n,i) => [n.id, { ...n, number: i + 1 }]));
      const relationLabel = edge => ({ iteration: '进入循环', exhausted: '结束迭代', back: '回到循环', next: '继续', true: '条件成立', false: '条件不成立', return: '返回', throw: '抛出', exception: '异常路径', resume: '等待完成', reject: '等待失败', break: '离开循环', continue: '进入下一轮', no_match: '无匹配分支' }[edge.raw?.kind] ?? '其他静态路径');
      return `<section class="behavior-steps" aria-label="关键行为步骤"><button data-toggle-control>展开完整控制流图</button><p class="muted">沿每步标出的去向阅读；源码顺序不表示所有步骤都会执行。静态说明仍需核对。</p><ol>${steps.nodes.map((n,i) => `<li data-node-id="${E(n.id)}" id="logic-${E(n.id.replace(':','-'))}"><header><span>${i + 1}</span><h2>${E(n.title)}</h2><button data-behavior-source="${E(n.id)}">定位源码</button></header><p>${E(n.description)}</p>${n.source === null ? '<p class="muted">源码版本或依据不可用。</p>' : `<code class="behavior-excerpt">${E(n.source.replace(/\s+/g, ' ').slice(0, 180))}${n.source.replace(/\s+/g, ' ').length > 180 ? '…' : ''}</code>`}<nav aria-label="步骤 ${i + 1} 的去向">${steps.edges.filter(e => e.from === n.id).map(e => { const target = byId.get(e.to); return target ? `<button data-logic-jump="${E(target.id)}">${E(relationLabel(e))} → 第 ${target.number} 步${target.number <= i + 1 ? '（回到前文）' : ''}</button>` : `<span>${E(relationLabel(e))} → ${e.terminal ? '结束函数' : '未提取目标'}</span>`; }).join('')}</nav><details><summary>展开语句与 Evidence · ${n.sourceLine ? 'L' + n.sourceLine : '版本待核对'}</summary>${n.source === null ? '' : `<pre>${E(n.source)}</pre>`}<p class="muted">${n.blockIds.map(E).join('、')} · ${E(n.block.kind)}</p><div class="links">${n.evidenceIds.map((id, j) => `<button data-group-evidence="${E(id)}">依据 ${j + 1}</button>`).join('')}</div></details></li>`).join('')}</ol>${steps.unknowns?.length ? `<details><summary>分析缺口 · ${steps.unknowns.length}</summary><p>${steps.unknowns.map(E).join('、')}</p></details>` : ''}</section>`;
    }
    const zoom = bookmarks.get(viewKey())?.zoom ?? 1;
    const focus = preference().focus;
    const nodeHtml = node => {
      const types = { definition: '文件内定义', 'external-definition': '跨文件定义', function: '文件内函数', external: '跨文件函数', group: '源码分组', 'external-group': '跨文件出口', unknown: '目标未解析', stage: '主线阶段', condition: '条件分支', block: '函数内部步骤' };
      return `<div class="graph-node ${E(node.kind)}" data-node-id="${E(node.id)}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px"><button class="graph-node-body" data-graph-node="${E(node.id)}" aria-pressed="false"><small>${types[node.kind] ?? node.kind}${node.inferred ? ' · AI 说明' : ''}</small><strong title="${E(node.title)}">${E(node.title)}</strong><span class="node-purpose">${E(node.description)}</span><span class="node-location">${E(node.file?.split('/').pop() ?? (node.keys?.length ? node.keys.length + ' 个关联函数' : ''))}${node.line ? ' · L' + node.line : ''}</span></button>${node.kind === 'group' ? `<button class="group-expand" data-expand-group="${E(node.id)}" aria-label="展开 ${E(node.title)}">展开 ${node.keys.length} 个函数</button>` : ''}</div>`;
    };
    const paths = [], labels = [];
    graph.edges.forEach((edge, i) => {
      const r = edgeRoute(edge, i); if (!r) return;
      paths.push(`<g data-edge-id="${E(edge.id)}" class="graph-edge ${edge.kind === 'unresolved' ? 'unresolved' : ''}"><path class="edge-line" d="${r.path}" marker-end="url(#graph-arrow)"></path><path class="edge-hit" d="${r.path}" data-graph-edge="${E(edge.id)}"></path></g>`);
      labels.push(`<button class="graph-edge-label" data-edge-label="${E(edge.id)}" data-graph-edge="${E(edge.id)}" style="left:${r.x}px;top:${r.y}px" aria-label="${E(graph.nodes.find(n=>n.id===edge.from)?.title)} ${E(edge.label)} ${E(graph.nodes.find(n=>n.id===edge.to)?.title)}" title="${E(edge.label)}">${E(edge.label)}${edge.facts?.length > 1 && graph.type === 'file' ? ' ×' + edge.facts.length : ''}</button>`);
    });
    return `<section class="graph-section" aria-label="${graph.type === 'file' ? '当前文件函数关系图' : graph.type === 'control' ? '函数内部控制流图' : '项目主线阶段图'}"><div class="graph-toolbar">${graph.type === 'control' ? '<button data-toggle-control>返回紧凑步骤</button>' : ''}<button data-graph-fit>适应全图</button><button data-zoom="out" aria-label="缩小画布">−</button><output id="graph-zoom">${Math.round(zoom * 100)}%</output><button data-zoom="in" aria-label="放大画布">+</button><button data-graph-locate ${selectedNode() ? '' : 'disabled'}>定位选中</button><label><input id="graph-focus" type="checkbox" ${focus ? 'checked' : ''}>聚焦${graph.type === 'mainline' ? '相邻阶段' : '上下游'}</label>${graph.grouped && preference().expanded.length ? '<button data-collapse-groups>收起分组</button>' : ''}</div><p class="graph-legend">${graph.type === 'file' ? '实线：已解析调用 · 虚线：目标未解析 · 跨文件出口单独标注。连线不表示执行先后。' : graph.type === 'control' ? '箭头表示可能的控制转移；条件、循环与提前返回保留。静态分析不代表实际执行。' : '箭头表示源码支持的阶段衔接；阶段划分与说明为未验证的展示解释。'} 点击连线查看依据。</p><div id="graph-canvas" tabindex="0" aria-label="流程画布，可滚动或拖动空白区域" data-zoom="${zoom}"><div id="graph-space" style="width:${graph.width * zoom}px;height:${graph.height * zoom}px"><div id="graph-scene" style="width:${graph.width}px;height:${graph.height}px;transform:scale(${zoom})"><svg class="graph-lines" width="${graph.width}" height="${graph.height}" aria-hidden="true"><defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#65866e"></path></marker></defs>${paths.join('')}</svg>${graph.nodes.map(nodeHtml).join('')}${labels.join('')}</div></div></div><p class="graph-caption">${graph.nodes.length} 个${graph.grouped ? '分组或函数' : '节点'} · ${graph.edges.length} 条关系 · ${graph.type === 'file' ? graph.scope === 'function-calls' ? '仅显示已知直接调用；未解析目标单独保留。' : `${graph.functionCount} 个文件内函数；孤立节点表示本次未提取到连接。` : '阅读概览，详细语句以源码为准。'}</p></section>`;
  }
  function fileGraphView() {
    const file = D.files.find(f => f.path === S.file), pref = preference();
    if (S.mode === 'calls' && S.reader) return `<h1>${E(label(S.reader))} · 调用关系</h1><p class="lede">直接调用者 → 当前函数 → 直接依赖。点击连线查看参数和结果；调用关系不表示执行顺序。</p>${graphHtml()}${impactHtml(S.reader)}`;
    return `<div class="breadcrumb">${E(S.file)}</div><h1>${pref.internal ? E(label(pref.internal)) + ' · 关键逻辑' : E(S.file.split('/').pop()) + ' · 函数关系'}</h1>${pref.internal ? '<button class="toolbar-link" data-file-overview>返回文件关系图</button>' : `<p class="lede">${E(file?.presentation?.purpose ?? '查看此文件内的函数及其直接调用关系。')}</p>`}${graphHtml()}<details class="explanation-origin"><summary>图的范围与解释来源</summary><p>节点来自本次快照定义；调用关系保留已有事实，分组按源码所属类或容器生成。大文件默认折叠分组。跨文件节点只显示直接出口，没有递归展开整个仓库。</p><p>节点用途已有 AI 解释时标注 AI 说明；其余功能待补齐。覆盖仍为 partial，没有连线不等于不存在调用。</p></details>`;
  }
  function flowBoundaryHtml(m) {
    const boundary = M.flowBoundaries(m.id), availableOutcomes = ['success', 'failure'].filter(kind => m.stages.some(s => s.outcome === kind));
    return `<div class="flow-paths" aria-label="主线路径"><button data-flow-path="all" aria-pressed="${!S.flowPath || S.flowPath === 'all'}">全部路径</button>${availableOutcomes.map(kind => `<button data-flow-path="${kind}" aria-pressed="${S.flowPath === kind}">${kind === 'success' ? '正常结果路径' : '失败／中止路径'}</button>`).join('')}</div><details class="details"><summary>状态与异步边界 · ${boundary.async.length + boundary.state.length + boundary.failures.length}</summary><p class="muted">阶段角色为源码支持的候选说明，未作为执行事实验证。</p>${[...boundary.async, ...boundary.state, ...boundary.failures].map(stage => `<p><button data-stage="${E(stage.id)}">${E(stage.title)}</button> ${E(stage.description)}</p>`).join('')}<p class="muted">重试、事务、补偿和外层恢复策略尚无完整证据。</p></details>`;
  }
  function runtimeHtml(m) {
    const r = M.flowObservations(m.id, D.runtime?.execution_id);
    return `<details class="details"><summary>运行观测对照</summary><p class="muted">静态可能路径与单次观测分别保留；函数 Span 不证明内部阶段全部执行。本页不采集数据。</p>${r.status === 'unavailable' ? `<p>无法展示观测：${E(r.reason)}</p>` : `<label>Execution <select aria-label="选择执行记录"><option>${E(r.executionId)}</option></select></label><p>Coverage ${E(r.coverage?.status)} · ${E(r.coverage?.reason_codes?.join('、'))}</p>${r.stages.map(stage => `<p><button data-stage="${E(stage.id)}">${E(m.stages.find(s => s.id === stage.id).title)}</button> · ${stage.observations.length ? '所属函数有观测；阶段执行未知' : '静态可能；本次未映射'}</p>${stage.observations.map(o => `<details><summary>观测 ${E(o.observation_id)}</summary><pre>${E(JSON.stringify(o, null, 2))}</pre></details>`).join('')}`).join('')}<p>未映射到此主线的片段：${r.unmapped.length}</p><details><summary>核对未映射片段与 Trace</summary><p>Trace digest ${E(r.traceDigest)}</p><pre>${E(JSON.stringify(r.unmapped, null, 2))}</pre></details>`}</details>`;
  }
  function mainlineView() {
    const m = M.flowOverview(S.mainline);
    if (!m) return '<p class="empty">没有可查看的主线。</p>';
    if (!m.available) return `<h1>${E(m.title)}</h1><p class="empty">${E(m.unavailable)}</p>`;
    return `<div class="breadcrumb">项目主线 / 源码支持的候选</div><h1>${E(m.title)}</h1><p class="lede">${E(m.purpose)}</p>${archifyPanel.view(S.mainline)}${archifyPanel.isOpen(S.mainline) ? '' : flowBoundaryHtml(m) + runtimeHtml(m)}<dl class="mainline-io"><div><dt>触发</dt><dd>${E(m.trigger)}</dd></div><div><dt>输入</dt><dd>${E(m.input)}</dd></div><div><dt>结果</dt><dd>${E(m.output)}</dd></div></dl>${archifyPanel.isOpen(S.mainline) ? '' : graphHtml()}${archifyPanel.isOpen(S.mainline) ? '' : `<details class="details"><summary>参与实现 · ${m.definitionKeys.length}</summary><div class="links">${m.definitionKeys.map(fnLink).join('')}</div></details><section class="stage-notes"><h2>按阶段阅读</h2><p class="muted">选择说明可同步高亮图中节点；右侧显示该阶段的函数与源码。</p>${m.stages.map(stage => `<article class="stage-note" data-note-id="${E(stage.id)}"><button data-stage="${E(stage.id)}"><strong>${E(stage.title)}</strong></button><p>${E(stage.description)}</p><button class="toolbar-link" data-stage-locate="${E(stage.id)}">在图中定位</button></article>`).join('')}</section><details class="explanation-origin"><summary>候选主线的范围与来源</summary><p>${E(m.boundary)}</p><p>阶段与注释为 llm_inferred、未验证的展示说明，绑定当前源码哈希。并非完整业务链，也没有作为运行轨迹验收。</p></details>`}`;
  }
  function updateHighlights() {
    document.querySelectorAll('[data-change]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.change === comparison.selected)));
    const selected = selectedNode(), selectedEdge = S.detail === 'edge' ? graph?.edges.find(e => e.id === S.edge) : null;
    const neighborhood = selectedEdge ? { nodes: new Set([selectedEdge.from, selectedEdge.to]), edges: new Set([selectedEdge.id]) } : graph && selected ? M.neighbors(graph, selected) : null;
    const dim = Boolean(preference().focus && neighborhood);
    const flowRoute = S.context === 'mainline' && S.flowPath && S.flowPath !== 'all' ? new Set(M.flowRoute(S.mainline, S.flowPath)) : null;
    document.querySelectorAll('[data-node-id]').forEach(el => {
      const match = el.dataset.nodeId === selected;
      el.classList.toggle('selected', match); el.classList.toggle('dimmed', (dim && !neighborhood.nodes.has(el.dataset.nodeId)) || (flowRoute && !flowRoute.has(el.dataset.nodeId)));
      el.querySelector('[data-graph-node]')?.setAttribute('aria-pressed', String(match));
    });
    document.querySelectorAll('[data-edge-id], [data-edge-label]').forEach(el => {
      const id = el.dataset.edgeId ?? el.dataset.edgeLabel;
      el.classList.toggle('dimmed', dim && !neighborhood.edges.has(id)); el.classList.toggle('selected', S.detail === 'edge' && S.edge === id);
    });
    document.querySelectorAll('.function-row').forEach(el => { const selected = el.dataset.related === S.fn; el.classList.toggle('selected', selected); el.querySelector('[data-fn]')?.setAttribute('aria-pressed', String(selected)); });
    document.querySelectorAll('[data-note-id]').forEach(el => el.classList.toggle('selected', el.dataset.noteId === S.stage));
    const locate = document.querySelector('[data-graph-locate]'); if (locate) locate.disabled = !selected;
  }
  function sourceReferences(refs) {
    return refs.map(ref => `<section class="source-reference"><p class="breadcrumb">${E(ref.file)} · L${ref.startLine}–${ref.endLine}</p><pre>${E(ref.excerpt)}</pre><div class="links">${fnLink(ref.definition_key)}<button data-enter-file="${E(ref.file)}" data-enter-key="${E(ref.definition_key)}">进入所在文件</button></div><details><summary>版本绑定</summary><p class="muted">Snapshot：${E(ref.snapshot)}<br>源码哈希：${E(ref.source_digest)}</p></details></section>`).join('');
  }
  function factProof(f){return `<details><summary>来源与证据</summary><span class="tag">${E(f.basis?.kind ?? 'unknown')}</span>${(f.evidence_ids ?? []).map(id=>{const e=D.evidence[id];return e?`<p class="muted"><button data-group-evidence="${E(id)}">${E(e.file_path)} · ${e.line?'L'+e.line:'字节 '+e.span.start_byte+'–'+e.span.end_byte}</button></p>`:'';}).join('')}<details><summary>原始解析</summary><pre>${E(JSON.stringify(f,null,2))}</pre></details></details>`;}
  function callsHtml(items, direction) {
    if (!items.length) return '<p>本次未提取到，不代表不存在。</p>';
    return items.map(f => `<section class="call-detail"><p>${direction === 'incoming' ? fnLink(f.subject.definition_key) : defs.has(f.value.target_definition_key) ? fnLink(f.value.target_definition_key) : `<code>${E(f.value.call)}</code> · 目标未解析`}</p>${direction === 'outgoing' ? `<p>参数：<code>${E((f.value.argument_expressions ?? []).join('；') || '未提取参数')}</code></p><p>结果：<code>${E(f.value.result_binding ?? (f.value.returned_directly ? '直接返回' : '未提取绑定'))}</code></p>` : ''}${factProof(f)}</section>`).join('');
  }
  function inspector() {
    const panel = $('inspector'); panel.hidden = !S.detail; $('inspector-resize').hidden = !S.detail;
    detailNavigation = null;
    if (!S.detail) { panel.innerHTML = ''; return; }
    let title = '', body = '';
    if (S.detail === 'group-evidence') {
      const e = D.evidence[S.groupEvidence], file = D.files.find(f=>f.path===e?.file_path);
      if (!e || !file?.verified || file.source_digest !== e.source_digest) { panel.innerHTML = '<p>来源版本无法核对。</p>'; return; }
      const bytes = new TextEncoder().encode(file.source), decode = end => new TextDecoder().decode(bytes.slice(0,end)).split('\n').length;
      const line = decode(e.span.start_byte), endLine = decode(e.span.end_byte);
      title = '分组依据';
      body = `<h2>分组依据</h2><p>${E(e.file_path)} · L${line}–${endLine}</p><p class="muted">源码依据不等于业务解释已验证。</p>${sourceHtml(file, {line,endLine})}<button data-file="${E(e.file_path)}">阅读文件</button>`;
    } else if (S.detail === 'fn') {
      const d = defs.get(S.fn); if (!d) { panel.hidden = true; return; }
      title = d.qualified_name;
      const sum = summary(d), file = D.files.find(f => f.path === d.file_path);
      const related = mainlines.filter(m => m.stages.some(s => s.keys.includes(S.fn)));
      const cfg = M.controls.find(f => f.subject.definition_key === S.fn);
      const selectedStep = S.context === 'file' && Boolean(S.reader) && graph?.type === 'control' && S.fn === S.reader ? readerBehaviorSteps(D, S.reader, M).nodes.find(n => n.id === graphSelection) : null;
      const sourceRange = selectedStep?.sourceLine && selectedStep.source !== null ? { start: selectedStep.sourceLine, end: selectedStep.sourceLine + selectedStep.source.split('\n').length - 1 } : undefined;
      body = `${S.reader === S.fn ? '' : `<h2>${E(title)}</h2><p class="function-purpose">${E(sum.text)}</p><button data-read-function="${E(d.definition_key)}">阅读此函数</button>`}<p class="breadcrumb">${E(d.file_path)} · ${d.line ? 'L' + d.line : '源码版本未核对'}</p><div class="section-title" id="detail-source"><h3>对照源码</h3><button data-wrap aria-pressed="${wrapSource}">自动换行：${wrapSource ? '开' : '关'}</button></div>${sourceHtml(file, d, sourceRange)}<section id="detail-relations"><h3>关联</h3><details class="details"><summary>参与的项目主线 · ${related.length}</summary><div class="links">${related.map(m => `<button data-mainline="${E(m.id)}">${E(m.title)}</button>`).join('') || '尚未整理相关主线。'}</div></details>${!loader.hasCalls() ? deferredCalls() : `<details class="details"><summary>谁调用它 · ${new Set(calls.filter(f => f.value.target_definition_key === S.fn && f.subject.definition_key !== S.fn).map(f => f.subject.definition_key)).size} 个调用者 · ${calls.filter(f => f.value.target_definition_key === S.fn).length} 处位置</summary>${callsHtml(calls.filter(f => f.value.target_definition_key === S.fn), 'incoming')}</details><details class="details"><summary>它调用谁 · ${calls.filter(f => f.subject.definition_key === S.fn).length} 处位置</summary>${callsHtml(calls.filter(f => f.subject.definition_key === S.fn), 'outgoing')}</details>`}${!loader.hasDefinition(S.fn) ? deferredAnalysis(S.fn) : `<details class="details"><summary>内部条件与副作用</summary>${cfg ? cfg.value.blocks.filter(b => !['entry', 'exit'].includes(b.kind)).map(b => `<pre>${E(b.source_excerpt ?? b.kind)}</pre>`).join('') : '<p>内部控制流未提取，可直接阅读源码。</p>'}${own(S.fn).filter(f => f.kind === 'effect').map(f => `<p>可能的副作用：${E(f.value.operation ?? f.value.effect_kind)}</p>`).join('')}</details>`}</section>`;
    } else if (S.detail === 'change') {
      const change = comparison.result?.changes.find(c => c.id === comparison.selected); if (!change) return;
      title = '变更依据'; body = changeBody(change);
    } else if (S.detail === 'definition') {
      const d = defs.get(S.fn), file = D.files.find(f => f.path === d?.file_path); if (!d) return;
      title = d.qualified_name;
      body = `<h2>${E(title)}</h2><p>调用解析到 ${E(d.kind)} 定义；此节点不作为已提取的函数展示。</p><p class="breadcrumb">${E(d.file_path)}</p><button data-enter-file="${E(d.file_path)}">进入所在文件</button><h3>对照源码</h3>${sourceHtml(file, d)}`;
    } else if (S.detail === 'stage') {
      const stage = line()?.stages.find(s => s.id === S.stage); if (!stage) return;
      title = stage.title;
      body = `<h2>${E(title)}</h2><p>${E(stage.description)}</p><p class="muted">主线阶段说明 · llm_inferred · 未验证</p><h3>相关函数</h3><div class="links">${stage.keys.map(fnLink).join('')}</div>${stage.keys.map(dataFlowHtml).join('')}<h3>阶段源码</h3>${sourceReferences(stage.refs)}<button data-stage-locate="${E(stage.id)}">定位图中阶段</button>`;
    } else if (S.detail === 'node') {
      const node = graph?.nodes.find(n => n.id === S.node); if (!node) return;
      title = node.title;
      body = `<h2>${E(title)}</h2><p>${E(node.description)}</p>${node.kind === 'group' ? `<button data-expand-group="${E(node.id)}">展开分组中的函数</button>` : ''}${node.keys?.length ? `<h3>相关定义</h3><div class="links">${node.keys.map(fnLink).join('')}</div>` : ''}${node.file ? `<p class="breadcrumb">${E(node.file)}</p>` : ''}${node.block ? `<h3>步骤源码</h3><pre>${E(node.block.source_excerpt ?? '入口或出口，无独立执行语句。')}</pre>` : ''}<h3>来源与边界</h3>${node.kind === 'unknown' ? '<p>调用位置存在，但目标没有解析到函数定义。不能据此判断目标不存在或补出下游路线。</p>' : ''}${node.facts.map(factProof).join('') || '<p>分组由当前快照中的函数归属生成。</p>'}`;
    } else if (S.detail === 'edge') {
      const edge = graph?.edges.find(e => e.id === S.edge); if (!edge) return;
      title = edge.label;
      const from = graph.nodes.find(n => n.id === edge.from), to = graph.nodes.find(n => n.id === edge.to);
      body = `<h2>${E(title)}</h2><p>${E(from.title)} → ${E(to.title)}</p>${graph.type === 'file' ? `<p>共 ${edge.facts.length} 处调用；分组连线可能汇总多个函数间的调用，不表示执行顺序。</p>${callsHtml(edge.facts, 'outgoing')}` : graph.type === 'control' ? `<p>静态控制关系：<code>${E(edge.raw.kind)}</code>。表示可能的控制转移，不代表已经执行。</p>${edge.facts.map(factProof).join('')}` : `<p>源码支持的阶段衔接；分支标签与阶段划分属于未验证的阅读说明。</p>${sourceReferences([...(from.refs ?? []), ...(to.refs ?? [])])}`}`;
    }
    panel.innerHTML = `<div class="detail-head"><strong class="detail-context">${E(title)}</strong><button data-close>关闭详情 · Esc</button>${S.detail === 'fn' ? '<div class="detail-nav"><button data-detail-section="source">源码</button><button data-detail-section="relations">调用关系</button><button data-detail-section="evidence">证据</button></div>' : ''}</div>${body}`;
    syncDetailNav();
  }
  function syncDetailNav() {
    const panel = $('inspector'); if (S.detail !== 'fn') return;
    const boundary = panel.getBoundingClientRect().top + (panel.querySelector('.detail-head')?.offsetHeight ?? 0) + 24;
    let active = 'source';
    for (const name of ['source', 'relations', 'evidence']) if ($('detail-' + name)?.getBoundingClientRect().top <= boundary) active = name;
    if (detailNavigation) active = detailNavigation;
    panel.querySelectorAll('[data-detail-section]').forEach(b => b.setAttribute('aria-current', b.dataset.detailSection === active ? 'location' : 'false'));
  }
  function navigateDetail(section) {
    detailNavigation = section; const panel = $('inspector');
    if (section === 'top') panel.scrollTop = 0;
    else { const target = $('detail-' + section); if (target) panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.querySelector('.detail-head').offsetHeight - 12; }
    syncDetailNav();
  }
  $('inspector').addEventListener('scroll', syncDetailNav, { passive: true });
  for (const event of ['wheel', 'touchstart', 'keydown', 'pointerdown']) $('inspector').addEventListener(event, () => { detailNavigation = null; syncDetailNav(); }, { passive: true });
  function contextBar() {
    const back = returnContexts.at(-1);
    $('context-bar').innerHTML = `${back ? `<button data-context-return>返回 ${E(back.context === 'requirements' ? '需求核对' : back.context === 'overview' ? '项目总览' : back.context === 'comparison' ? '本次变更' : back.context === 'capability' ? capabilities.get(back.capability)?.title ?? '待归类' : back.context === 'mainline' ? mainlines.find(m => m.id === back.mainline)?.title ?? '主线' : back.reader ? label(back.reader) : back.file.split('/').pop() + (back.mode === 'graph' ? ' · 关系图' : ''))}</button>` : ''}${S.reader ? `<nav class="object-breadcrumb" aria-label="当前阅读对象"><button data-reader-file>${E(S.file.split('/').pop())}</button><span>› ${E(label(S.reader))}</span></nav><button data-show-source>查看源码与依据</button>` : ''}`;
  }

  function render(content = true) {
    const detailTop = $('inspector').scrollTop;
    tree(); contextBar();
    $('reading-nav').hidden = S.context !== 'file';
    $('files-tab').textContent = S.reader ? '函数说明' : '文件阅读';
    $('flows-tab').textContent = S.reader ? '关键逻辑' : '函数流程';
    $('files-tab').setAttribute('aria-pressed', String(S.mode === 'text'));
    $('flows-tab').setAttribute('aria-pressed', String(S.mode === 'graph'));
    $('calls-tab').hidden = !S.reader; $('calls-tab').setAttribute('aria-pressed', String(S.mode === 'calls'));
    document.querySelector('[data-directory-toggle]').setAttribute('aria-expanded', String(document.querySelector('.sidebar').classList.contains('mobile-open')));
    if (content) {
      activeBookmark = viewKey();
      if (S.context === 'file' && S.mode === 'text') { graph = null; graphCacheKey = ''; }
      $('center').innerHTML = S.context === 'requirements' ? requirementPanel.view() : S.context === 'overview' ? overviewView() : S.context === 'comparison' ? comparisonView() : S.context === 'capability' ? capabilityView() : S.context === 'mainline' ? mainlineView() : S.mode === 'text' ? (S.reader ? functionView() : fileView()) : fileGraphView();
    }
    if (content && S.context === 'mainline') archifyPanel.wireFrame(S.mainline);
    renderPicker(); inspector(); $('inspector').scrollTop = detailTop;
    updateHighlights(); restorePosition();
  }
  let pickerMatches = [], pickerIndex = -1, globalMatches = [], globalIndex = -1;
  const selectedFunction = () => S.reader ? label(S.reader) : S.fn && ['function', 'method'].includes(defs.get(S.fn)?.kind) && defs.get(S.fn)?.file_path === S.file ? label(S.fn) : '';
  function renderPicker() {
    const host = $('function-picker'), fns = functions.filter(d => d.file_path === S.file);
    host.hidden = S.context !== 'file';
    host.innerHTML = `<label for="function-search">当前文件 · ${fns.length} 个函数</label><input id="function-search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="function-options" autocomplete="off" placeholder="${fns.length ? '选择函数…' : '此文件没有函数'}" value="${E(selectedFunction())}" ${fns.length ? '' : 'disabled'}><div id="function-options" role="listbox" aria-label="当前文件函数" hidden></div>`;
  }
  function pickFileFunction(key) {
    readFunction(key);
  }

  function filterPicker(query = '') {
    pickerMatches = functions.filter(d => d.file_path === S.file && `${d.qualified_name} ${d.line ?? ''}`.toLowerCase().includes(query.toLowerCase())); pickerIndex = -1;
    $('function-options').innerHTML = `<p role="status">${pickerMatches.length} 个匹配函数</p>` + pickerMatches.map((d, i) => `<button role="option" aria-selected="${S.fn === d.definition_key}" tabindex="-1" id="function-option-${i}" data-pick="${E(d.definition_key)}">${E(d.qualified_name)}<span>${S.fn === d.definition_key ? '已选 · ' : ''}${d.line ? 'L' + d.line : ''}</span></button>`).join('');
    $('function-options').hidden = false; $('function-search').setAttribute('aria-expanded', 'true'); $('function-search').removeAttribute('aria-activedescendant');
  }
  function closePicker() { const input = $('function-search'); if (!input) return; $('function-options').hidden = true; input.value = selectedFunction(); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function highlightOption(input, list, index) {
    const options = [...list.querySelectorAll('[role=option]')];
    options.forEach((option, i) => option.classList.toggle('keyboard-active', i === index));
    const option = options[index]; if (!option) return;
    input.setAttribute('aria-activedescendant', option.id);
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }
  $('function-picker').addEventListener('focusin', e => { if (e.target.id === 'function-search') { e.target.select(); filterPicker(); } });
  $('function-picker').addEventListener('input', e => { if (e.target.id === 'function-search') filterPicker(e.target.value); });
  $('function-picker').addEventListener('click', e => {
    if (e.target.id === 'function-search' && $('function-options').hidden) { e.target.select(); filterPicker(); }
    const option = e.target.closest('[data-pick]'); if (option) { closePicker(); pickFileFunction(option.dataset.pick); }
  });
  $('function-picker').addEventListener('keydown', e => {
    if (e.target.id !== 'function-search') return;
    if (['Escape', 'Tab'].includes(e.key)) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } closePicker(); return; }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault(); if ($('function-options').hidden) filterPicker(); if (!pickerMatches.length) return;
      pickerIndex = (pickerIndex + (e.key === 'ArrowDown' ? 1 : -1) + pickerMatches.length) % pickerMatches.length;
      highlightOption(e.target, $('function-options'), pickerIndex);
    }
    if (e.key === 'Enter' && !$('function-options').hidden) { e.preventDefault(); const d = pickerMatches[Math.max(0, pickerIndex)]; if (d) { closePicker(); pickFileFunction(d.definition_key); } }
  });
  async function searchGlobal(query = '') {
    if (/(影响|调用|impact|caller)/i.test(query) && !loader.hasCalls()) {
      if (!await loadFor(() => loader.calls(), () => searchGlobal(query))) return;
      if ($('global-search').value !== query) return;
    }
    globalIndex = -1;
    const answer = queryReader(D, query, { capabilities, risk, searchIndex });
    const all = answer.objects;
    globalMatches = all.slice(0, 40);
    const messages = { answered: answer.intent === 'search' ? '相关对象，可下钻核对' : '已定位，选择对象核对', ambiguous: '存在同名对象，请按路径消歧', no_match: '没有匹配；可换用职责关键词或从源码目录进入', unsupported: '尚不能回答这个问题；下方仅列相关对象' };
    const basis = { identifier: '名称或路径', llm_inferred: 'AI 推断 · 未验证', reviewed_alias: '经核对别名' };
    $('global-results').innerHTML = `<p class="search-hint" role="status">${query.trim() ? messages[answer.status] : '搜索文件、函数用途、主线或业务别名'}${query.trim() ? ' · ' + all.length + ' 项' : ''}</p>${answer.fallback && all.length ? '<p class="search-hint">原问题未获回答，相关实现不代表已确认入口。</p>' : ''}${globalMatches.map((o, i) => `<button role="option" aria-selected="false" tabindex="-1" id="global-option-${i}" data-global-pick="${i}"><strong>${E(o.title)}</strong><small>${E(o.subtitle ?? ({capability:'能力候选',mainline:'主线候选',fn:'函数'}[o.type]))}</small>${o.matchReason ? `<span>${E(o.matchReason)}</span><small>${E(basis[o.basis] ?? '候选')} · 相关实现</small>` : ''}</button>`).join('')}${all.length > 40 ? '<p class="search-hint">显示前 40 项；增加关键词缩小范围。</p>' : ''}<p class="search-hint">Snapshot ${E(answer.snapshot)} · 离线冻结范围 · Coverage partial</p>`;
    $('global-results').hidden = false;
    $('global-search').setAttribute('aria-expanded', 'true');
    $('global-search').removeAttribute('aria-activedescendant');
  }
  function closeGlobal() { $('global-results').hidden = true; $('global-search').setAttribute('aria-expanded', 'false'); $('global-search').removeAttribute('aria-activedescendant'); $('global-search-host').classList.remove('search-open'); }
  function pickGlobal(index) {
    const item = globalMatches[index]; if (!item) return; closeGlobal(); $('global-search').value = '';
    if (item.type === 'capability') enterCapability(item.key);
    else if (item.type === 'mainline') enterMainline(item.key);
    else if (item.type === 'file') enterFile(item.key);
    else {
      readFunction(item.key);
    }
  }
  $('global-search').addEventListener('focus', e => searchGlobal(e.target.value));
  $('global-search').addEventListener('input', e => searchGlobal(e.target.value));
  $('global-search').addEventListener('click', e => { if ($('global-results').hidden) searchGlobal(e.target.value); });
  $('global-search').addEventListener('keydown', e => {
    if (['Escape', 'Tab'].includes(e.key)) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } closeGlobal(); return; }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault(); if ($('global-results').hidden) searchGlobal(e.target.value); if (!globalMatches.length) return;
      globalIndex = (globalIndex + (e.key === 'ArrowDown' ? 1 : -1) + globalMatches.length) % globalMatches.length;
      highlightOption(e.target, $('global-results'), globalIndex);
    }
    if (e.key === 'Enter' && !$('global-results').hidden && globalMatches.length) { e.preventDefault(); pickGlobal(Math.max(0, globalIndex)); }
  });
  function selectStage(id, locate = false) {
    const stage = line()?.stages.find(s => s.id === id); if (!stage) return;
    savePosition(); S.stage = id; mainlineSelections.set(S.mainline, id); S.detail = 'stage'; graphSelection = id; render(false); $('inspector').scrollTop = 0;
    if (locate) { S.detail = null; render(false); locateGraph(); } else focusInspector();
    announce('已选择阶段：' + stage.title);
  }
  function selectGraphNode(id) {
    const node = graph?.nodes.find(n => n.id === id); if (!node) return;
    savePosition(); graphSelection = id;
    if (S.context === 'mainline') selectStage(id);
    else if (['function', 'external', 'definition', 'external-definition'].includes(node.kind)) selectFunction(node.keys[0]);
    else { S.node = id; S.detail = 'node'; render(false); $('inspector').scrollTop = 0; focusInspector(); }
  }
  async function openInternal(key) {
    if (!await loadFor(() => loader.definition(key), () => openInternal(key))) return;
    const d = defs.get(key); if (!d) return;
    savePosition(); if (S.context !== 'file' || S.file !== d.file_path) { rememberContext(); S.file = d.file_path; }
    S.context = 'file'; S.reader = key; S.mode = 'graph'; S.fn = key; S.detail = null; preference().internal = key; preference().mode = 'graph';
    graphSelection = null; render();
  }
  function setZoom(zoom) {
    const canvas = $('graph-canvas'); if (!canvas || !graph) return;
    const previous = Number(canvas.dataset.zoom), next = Math.max(0.2, Math.min(1.8, zoom));
    const x = (canvas.scrollLeft + canvas.clientWidth / 2) / previous, y = (canvas.scrollTop + canvas.clientHeight / 2) / previous;
    canvas.dataset.zoom = String(next); $('graph-scene').style.transform = `scale(${next})`;
    $('graph-space').style.width = graph.width * next + 'px'; $('graph-space').style.height = graph.height * next + 'px';
    $('graph-zoom').textContent = Math.round(next * 100) + '%';
    canvas.scrollLeft = x * next - canvas.clientWidth / 2; canvas.scrollTop = y * next - canvas.clientHeight / 2; savePosition();
  }
  function locateGraph() {
    const canvas = $('graph-canvas'), node = graph?.nodes.find(n => n.id === selectedNode()); if (!canvas || !node) return;
    const zoom = Number(canvas.dataset.zoom);
    canvas.scrollLeft = Math.max(0, (node.x + node.width / 2) * zoom - canvas.clientWidth / 2);
    canvas.scrollTop = Math.max(0, (node.y + node.height / 2) * zoom - canvas.clientHeight / 2);
    $('reading').scrollTop += canvas.getBoundingClientRect().top - $('reading').getBoundingClientRect().top - ($('reading-nav').hidden ? 16 : $('reading-nav').offsetHeight + 12);
    const target = [...document.querySelectorAll('[data-graph-node]')].find(el => el.dataset.graphNode === node.id); target?.focus({ preventScroll: true }); savePosition();
  }
  function locateFunction() {
    if (!S.fn || defs.get(S.fn)?.file_path !== S.file) return;
    if (S.mode === 'text') {
      const row = [...document.querySelectorAll('.function-row')].find(el => el.dataset.related === S.fn);
      if (row) { $('reading').scrollTop += row.getBoundingClientRect().top - $('reading').getBoundingClientRect().top - $('reading-nav').offsetHeight - 12; row.querySelector('button')?.focus({ preventScroll: true }); savePosition(); }
    } else {
      const group = graph?.nodes.find(n => n.kind === 'group' && n.keys.includes(S.fn));
      if (group) { savePosition(); preference().expanded.push(group.id); render(); }
      locateGraph();
    }
  }
  function resizeInspector(width) {
    const maximum = Math.max(360, Math.min(680, window.innerWidth - 664));
    inspectorWidth = Math.max(360, Math.min(maximum, width));
    $('inspector-resize').setAttribute('aria-valuemax', String(maximum));
    document.documentElement.style.setProperty('--inspector-width', inspectorWidth + 'px');
    $('inspector-resize').setAttribute('aria-valuenow', String(inspectorWidth));
  }
  document.addEventListener('submit', async event => {
    if (event.target.id === 'requirement-review') { event.preventDefault(); await requirementPanel.handleSubmit(event.target); return; }
    if (event.target.id === 'definition-correspondence') {
      event.preventDefault(); const form = new FormData(event.target);
      const pair = { baseSnapshot: comparison.base.snapshot, targetSnapshot: comparison.target.snapshot, baseKey: form.get('baseKey'), targetKey: form.get('targetKey'), actor: form.get('actor'), reason: form.get('reason') };
      try { const pairs = [...comparison.pairs, pair]; const result = compareReaderSnapshots(comparison.base, comparison.target, { correspondences: pairs }); comparison.pairs = pairs; comparison.result = result; comparison.selected = null; S.detail = null; savePosition(); render(); }
      catch (error) { $('correspondence-error').textContent = '未添加：' + error.message; }
      return;
    }
    if (event.target.id !== 'capability-decision') return;
    event.preventDefault(); const form = new FormData(event.target), last = capabilities.history(S.capability).at(-1);
    try {
      capabilities.decide({ id: S.capability, action: event.submitter?.value ?? 'confirm', parent: form.get('parent') || null,
        actor: form.get('actor'), reason: form.get('reason'), expected_version: last?.version ?? 0 });
      capabilities = createReaderCapabilityModel(D, { storage: capabilityStorage }); savePosition(); render(); announce('阅读归属决定已保存在本机。');
    } catch (error) { $('decision-error').textContent = '未保存：' + error.message; }
  });
  document.addEventListener('click', async event => {
    const edge = event.target.closest('[data-graph-edge]');
    if (edge) { savePosition(); S.edge = edge.dataset.graphEdge; S.detail = 'edge'; render(false); $('inspector').scrollTop = 0; focusInspector(); return; }
    const el = event.target.closest('button'); if (!el) return;
    if (el.dataset.behaviorSource) {
      savePosition(); graphSelection = el.dataset.behaviorSource; S.fn = S.reader; S.detail = 'fn'; render(false);
      const panel = $('inspector'), source = panel.querySelector('.source-line.active');
      if (source) panel.scrollTop += source.getBoundingClientRect().top - panel.getBoundingClientRect().top - (panel.querySelector('.detail-head')?.offsetHeight ?? 0) - 16;
      focusInspector(); return;
    }
    if (el.hasAttribute('data-toggle-control')) { savePosition(); preference().rawControl = !preference().rawControl; graphCacheKey = ''; render(); return; }
    if (el.hasAttribute('data-load-retry')) { await retryLoad?.(); return; }
    if (el.hasAttribute('data-load-calls') || el.dataset.loadDefinition) {
      const action = () => el.dataset.loadDefinition ? loader.definition(el.dataset.loadDefinition) : loader.calls();
      const retry = async () => { if (await loadFor(action, retry)) render(); };
      await retry(); return;
    }
    if (await archifyPanel.handleClick(el, S.mainline)) return;
    if (await requirementPanel.handleClick(el)) return;
    if (el.dataset.logicJump) { const target = document.getElementById('logic-' + el.dataset.logicJump.replace(':','-')); target?.scrollIntoView({ block: 'start', behavior: 'auto' }); target?.querySelector('button')?.focus({ preventScroll: true }); }
    else if (el.dataset.comparisonFunction) { savePosition(); comparison.focus = { key: el.dataset.comparisonFunction, side: el.dataset.comparisonSide }; S.detail = null; render(); $('reading').scrollTop = 0; }
    else if (el.hasAttribute('data-comparison-return')) { savePosition(); comparison.focus = null; S.detail = comparison.selected ? 'change' : null; render(); }
    else if (el.hasAttribute('data-open-requirements')) enterRequirements();
    else if (el.hasAttribute('data-project-overview')) enterOverview();
    else if (el.hasAttribute('data-open-comparison')) enterComparison();
    else if (el.hasAttribute('data-export-bundle')) { if (!await loadFor(() => loader.all(), () => el.click())) return; const url = URL.createObjectURL(new Blob([JSON.stringify(D)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'reader-' + D.snapshot.slice(0, 16) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    else if (el.hasAttribute('data-base-current') || el.hasAttribute('data-target-current')) { comparison[el.hasAttribute('data-base-current') ? 'base' : 'target'] = D; comparison.pairs = []; comparison.selected = null; comparison.error = ''; comparison.result = comparison.base ? compareReaderSnapshots(comparison.base, comparison.target) : null; S.detail = null; render(); }
    else if (el.hasAttribute('data-clear-correspondences')) { comparison.pairs = []; comparison.selected = null; comparison.result = compareReaderSnapshots(comparison.base, comparison.target); S.detail = null; render(); }
    else if (el.dataset.change) { savePosition(); comparison.selected = el.dataset.change; S.detail = 'change'; render(false); $('inspector').scrollTop = 0; focusInspector(); }
    else if (el.dataset.navigation) { document.querySelector('.sidebar').dataset.navigation = el.dataset.navigation; capabilityMenu(); }
    else if (el.dataset.capability) enterCapability(el.dataset.capability, Boolean(el.closest('#center')));
    else if (el.hasAttribute('data-global-pick')) pickGlobal(Number(el.dataset.globalPick));
    else if (el.dataset.groupEvidence) {
      const id = el.dataset.groupEvidence;
      const retry = async () => { if (await loadFor(async () => { const [e] = await loader.evidence([id]); await loadSource(e.file_path); }, retry)) { S.groupEvidence = id; S.detail = 'group-evidence'; render(false); focusInspector(); } };
      await retry(); return;
       }
    else if (el.dataset.file) { event.preventDefault(); enterFile(el.dataset.file); }
    else if (el.dataset.treeFn) readFunction(el.dataset.treeFn);
    else if (el.dataset.fn) el.closest('#inspector') ? selectFunction(el.dataset.fn) : readFunction(el.dataset.fn);
    else if (el.dataset.readFunction) readFunction(el.dataset.readFunction);
    else if (el.hasAttribute('data-reader-file')) { preference().internal = null; enterFile(S.file, null, false); }
    else if (el.hasAttribute('data-show-source')) { S.fn = S.reader; S.detail = 'fn'; render(false); $('inspector').scrollTop = 0; }
    else if (el.dataset.enterFile) enterFile(el.dataset.enterFile, el.dataset.enterKey);
    else if (el.dataset.mainline) enterMainline(el.dataset.mainline, Boolean(el.closest('#inspector')) || S.context === 'capability' || S.context === 'overview' || S.context === 'requirements');
    else if (el.dataset.internal) openInternal(el.dataset.internal);
    else if (el.dataset.graphNode) selectGraphNode(el.dataset.graphNode);
    else if (el.dataset.flowPath) { savePosition(); S.flowPath = el.dataset.flowPath; graphSelection = null; S.stage = null; S.detail = null; render(); }
    else if (el.dataset.stage) selectStage(el.dataset.stage);
    else if (el.dataset.stageLocate) selectStage(el.dataset.stageLocate, true);
    else if (el.dataset.expandGroup) { savePosition(); if (!preference().expanded.includes(el.dataset.expandGroup)) preference().expanded.push(el.dataset.expandGroup); S.detail = null; graphSelection = null; render(); }
    else if (el.hasAttribute('data-collapse-groups')) { savePosition(); preference().expanded = []; S.detail = null; graphSelection = null; render(); }
    else if (el.hasAttribute('data-file-overview')) { savePosition(); preference().internal = null; S.reader = null; graphSelection = null; S.detail = null; render(); }
    else if (el.hasAttribute('data-view-source')) changeMode('text');
    else if (el.hasAttribute('data-context-return')) { const previous = returnContexts.pop(); if (previous) { savePosition(); S = { ...S, ...previous, detail: previous.reader && window.innerWidth > 1180 ? 'fn' : null }; preference().internal = S.mode === 'graph' ? S.reader : null; graphSelection = null; render(); } }
    else if (el.hasAttribute('data-locate-function')) locateFunction();
    else if (el.hasAttribute('data-graph-locate')) locateGraph();
    else if (el.hasAttribute('data-graph-fit')) { const canvas = $('graph-canvas'); setZoom(Math.min(1, (canvas.clientWidth - 24) / graph.width, (canvas.clientHeight - 24) / graph.height)); canvas.scrollLeft = 0; canvas.scrollTop = 0; savePosition(); }
    else if (el.dataset.zoom) setZoom(Number($('graph-canvas').dataset.zoom) + (el.dataset.zoom === 'in' ? 0.15 : -0.15));
    else if (el.hasAttribute('data-close')) { S.detail = null; render(false); }
    else if (el.hasAttribute('data-wrap')) { const top = $('inspector').scrollTop; wrapSource = !wrapSource; inspector(); $('inspector').scrollTop = top; }
    else if (el.dataset.detailSection) navigateDetail(el.dataset.detailSection);
    else if (el.hasAttribute('data-directory-toggle')) { const sidebar = document.querySelector('.sidebar'); sidebar.classList.toggle('mobile-open'); el.setAttribute('aria-expanded', String(sidebar.classList.contains('mobile-open'))); }
    else if (el.hasAttribute('data-mobile-search')) { $('global-search-host').classList.add('search-open'); $('global-search').focus(); }
  });
  $('files-tab').onclick = () => changeMode('text'); $('flows-tab').onclick = () => changeMode('graph'); $('calls-tab').onclick = () => changeMode('calls');
  document.addEventListener('change', async event => {
    if (await requirementPanel.handleChange(event.target)) return;
    if (event.target.hasAttribute('data-verification-records')) {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw new Error('验证记录超过 1 MiB');
        const records = JSON.parse(await file.text());
        if (!Array.isArray(records) || records.length > 500 || records.some(r => !r || !Array.isArray(r.definitionKeys) || !Array.isArray(r.checks))) throw new Error('验证记录格式不正确');
        comparison.verificationRecords = records; savePosition(); render();
      } catch (error) { comparison.error = '未导入验证记录：' + error.message; $('comparison-error').textContent = comparison.error; }
      return;
    }
    const slot = event.target.dataset.bundleSlot; if (!slot) return;
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('阅读包超过 32 MiB 限制');
      const bundle = await validateReaderBundle(JSON.parse(await file.text()));
      const base = slot === 'base' ? bundle : comparison.base, target = slot === 'target' ? bundle : comparison.target;
      const result = base ? compareReaderSnapshots(base, target) : null;
      Object.assign(comparison, { base, target, result, pairs: [], selected: null, error: '' }); S.detail = null; render(); announce('阅读包已导入本机。');
    } catch (error) { comparison.error = '未导入：' + error.message; const message = $('comparison-error'); if (message) message.textContent = comparison.error; }
  });
  document.addEventListener('change', event => { if (event.target.id === 'file-order') { savePosition(); preference().fileOrder = event.target.value; render(); } if (event.target.id === 'graph-focus') { preference().focus = event.target.checked; updateHighlights(); } });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('#function-picker')) closePicker();
    if (!event.target.closest('#global-search-host') && !event.target.closest('[data-mobile-search]')) closeGlobal();
  });
  let drag = null;
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (event.target.id === 'inspector-resize') { event.target.focus({ preventScroll: true }); drag = { type: 'resize', x: event.clientX, width: inspectorWidth }; event.target.setPointerCapture(event.pointerId); event.preventDefault(); return; }
    const canvas = event.target.closest('#graph-canvas');
    if (canvas && !event.target.closest('button, [data-graph-edge]')) {
      drag = { type: 'canvas', x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
      canvas.setPointerCapture(event.pointerId); canvas.classList.add('dragging');
    }
  });
  document.addEventListener('pointermove', event => {
    if (drag?.type === 'resize') resizeInspector(drag.width + drag.x - event.clientX);
    else if (drag?.type === 'canvas') { const canvas = $('graph-canvas'); if (canvas) { canvas.scrollLeft = drag.left + drag.x - event.clientX; canvas.scrollTop = drag.top + drag.y - event.clientY; } }
  });
  for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => { if (drag) savePosition(); drag = null; $('graph-canvas')?.classList.remove('dragging'); });
  $('inspector-resize').addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); resizeInspector(event.key === 'Home' ? 360 : event.key === 'End' ? 680 : inspectorWidth + (event.key === 'ArrowLeft' ? 20 : -20));
    }
  });
  $('reading').addEventListener('scroll', savePosition, { passive: true });
  document.addEventListener('scroll', event => { if (event.target.id === 'graph-canvas') savePosition(); }, { capture: true, passive: true });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('global-search-host').classList.add('search-open'); $('global-search').focus(); $('global-search').select(); }
    if (event.key === 'Escape' && S.detail && !$('report-dialog').open) { event.preventDefault(); S.detail = null; render(false); }
  });
  $('report').onclick = () => $('report-dialog').showModal(); $('close-report').onclick = () => $('report-dialog').close();
  window.addEventListener('resize', () => { if (window.innerWidth > 1180) resizeInspector(inspectorWidth); });
  render();
})();
