// A reading guide is a version-bound presentation. It does not create Capability facts.
export function readerProjectOverview(data) {
  const guide = data.overview;
  const files = new Map(data.files.map(f => [f.path, f]));
  const result = { title: data.project, purpose: '', capabilities: [], basis: 'llm_inferred', verified: false,
    fallbackFile: data.files[0]?.path ?? null,
    scope: { files: data.files.length, definitions: data.definitions.length,
      languages: [...new Set(data.definitions.map(d => d.language).filter(Boolean))].sort(),
      snapshot: data.snapshot, coverage: data.coverage?.status ?? 'unknown' } };
  if (!guide) return { ...result, status: 'missing', reason: '项目目的与推荐入口尚未整理；可从完整源码目录开始。' };
  const bound = guide.repository === data.repository && guide.snapshot === data.snapshot &&
    Object.keys(guide.source_digests ?? {}).length > 0 &&
    Object.entries(guide.source_digests).every(([path, digest]) => files.get(path)?.verified && files.get(path).source_digest === digest);
  if (!bound) return { ...result, status: 'needs_review', reason: '总览与当前源码版本不一致，推荐入口需复核。' };
  const capabilities = (guide.capabilities ?? []).map(c => {
    const entry = c.entry;
    const def = entry?.type === 'fn' ? data.definitions.find(d => d.definition_key === entry.key && d.snapshot_id === data.snapshot) : null;
    const file = files.get(entry?.type === 'file' ? entry.key : def?.file_path);
    const flow = entry?.type === 'mainline' ? data.mainlines?.find(m => m.id === entry.key && m.snapshot === data.snapshot && m.available) : null;
    const available = flow ? Object.keys(flow.source_digests ?? {}).length > 0 && Object.entries(flow.source_digests).every(([path, digest]) => guide.source_digests[path] === digest)
      : Boolean(file?.verified && guide.source_digests[file.path] === file.source_digest);
    // A generated guide cannot grant itself human-confirmed Capability status.
    return { id: c.id, title: c.title, description: c.description, reason: c.reason,
      entry: available ? entry : null, status: 'candidate', available,
      unavailable: available ? null : '推荐入口缺失或源码未绑定，保留目录阅读。' };
  });
  return { ...result, status: 'available', purpose: guide.purpose, boundary: guide.boundary ?? '', capabilities };
}
