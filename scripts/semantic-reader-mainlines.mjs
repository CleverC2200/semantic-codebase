import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const catalog = JSON.parse(readFileSync(new URL('./semantic-reader-mainlines.json', import.meta.url), 'utf8'));

// Source excerpts are a presentation reference, not newly minted authoritative Evidence.
export function bindReaderMainlines(data, entries = catalog) {
  return entries.map(entry => {
    let unavailable = '';
    if ((entry.snapshot && entry.snapshot !== data.snapshot) || (entry.repository && entry.repository !== data.repository)) unavailable = '主线属于其他仓库或 Snapshot，需重新核对。';
    for (const [path, digest] of Object.entries(entry.source_digests)) {
      const file = data.files.find(f => f.path === path);
      if (!file?.verified || typeof file.source !== 'string' || file.source_digest !== digest ||
        (/^[a-f0-9]{64}$/.test(digest) && createHash('sha256').update(file.source).digest('hex') !== digest)) unavailable = '源码版本不匹配或缺失，暂不展示阶段图。';
    }
    const stageIds = new Set(entry.stages.map(s => s.id));
    if (stageIds.size !== entry.stages.length || entry.edges.some(e => !stageIds.has(e.from) || !stageIds.has(e.to))) unavailable ||= '阶段连接无法核对。';
    const stages = entry.stages.map(stage => {
      if (!stage.anchors.length) unavailable ||= '阶段缺少源码引用。';
      const refs = stage.anchors.map(anchor => {
        const file = data.files.find(f => f.path === anchor.file);
        const definitions = data.definitions.filter(d => d.file_path === anchor.file && d.qualified_name === anchor.function && (!anchor.definition_key || d.definition_key === anchor.definition_key));
        const definition = definitions.length === 1 ? definitions[0] : null;
        if (!file?.verified || !definition || entry.source_digests[anchor.file] !== file.source_digest) { unavailable ||= '阶段对应的函数无法核对。'; return null; }
        if (definition.snapshot_id && definition.snapshot_id !== data.snapshot) { unavailable ||= '阶段定义版本不匹配。'; return null; }
        if (/^[a-f0-9]{64}$/.test(definition.content_hash ?? '')) {
          const bytes = Buffer.from(file.source), span = definition.definition_span;
          if (!Number.isInteger(span?.start_byte) || !Number.isInteger(span?.end_byte) || span.start_byte < 0 || span.end_byte > bytes.length || span.end_byte <= span.start_byte ||
            createHash('sha256').update(bytes.subarray(span.start_byte, span.end_byte)).digest('hex') !== definition.content_hash) { unavailable ||= '阶段函数内容摘要不匹配。'; return null; }
        }
        const lines = file.source.split('\n');
        const source = lines.slice(definition.line - 1, definition.endLine).join('\n');
        const offset = source.indexOf(anchor.match);
        if (!anchor.match || offset < 0 || source.indexOf(anchor.match, offset + 1) >= 0) { unavailable ||= '阶段源码片段无法唯一核对。'; return null; }
        const startLine = definition.line + source.slice(0, offset).split('\n').length - 1;
        return { file: anchor.file, definition_key: definition.definition_key, startLine,
          endLine: startLine + anchor.match.split('\n').length - 1, excerpt: anchor.match,
          source_digest: file.source_digest, snapshot: data.snapshot };
      }).filter(Boolean);
      return { ...stage, refs, keys: [...new Set(refs.map(r => r.definition_key))] };
    });
    return { ...entry, basis: 'llm_inferred', verified: false, snapshot: data.snapshot,
      available: !unavailable, unavailable, stages: unavailable ? [] : stages, edges: unavailable ? [] : entry.edges };
  });
}
