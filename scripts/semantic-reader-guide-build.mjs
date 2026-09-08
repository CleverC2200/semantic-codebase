import { createHash } from 'node:crypto';
import { bindReaderMainlines } from './semantic-reader-mainlines.mjs';

// Apply an explicitly selected guide to frozen data. No repository code is executed.
export function applyReaderGuide(data, guide) {
  if (guide.repository !== data.repository || guide.snapshot !== data.snapshot) throw new Error('GUIDE_VERSION_MISMATCH');
  const files = new Map(data.files.map(f => [f.path, f]));
  for (const [path, digest] of Object.entries(guide.source_digests)) {
    const file = files.get(path);
    if (!file?.verified || typeof file.source !== 'string' || file.source_digest !== digest ||
      createHash('sha256').update(file.source).digest('hex') !== digest) throw new Error('GUIDE_SOURCE_MISMATCH: ' + path);
  }
  const mainlines = bindReaderMainlines(data, guide.mainlines.map(m => ({ ...m, repository: guide.repository, snapshot: guide.snapshot })));
  if (mainlines.some(m => !m.available)) throw new Error('GUIDE_MAINLINE_UNAVAILABLE: ' + mainlines.filter(m => !m.available).map(m => m.id + ': ' + m.unavailable).join('; '));
  const definitions = data.definitions.map(d => {
    const correction = guide.corrections?.find(c => c.definition_key === d.definition_key);
    if (!correction) return d;
    if (correction.content_hash !== d.content_hash || !guide.source_digests[d.file_path] || !correction.reason?.trim()) throw new Error('GUIDE_CORRECTION_MISMATCH');
    return { ...d, presentation: { ...d.presentation, logic: correction.logic,
      basis: 'llm_inferred', verified: false, correction: { reason: correction.reason, kind: 'source_review', reviewer: 'Codex', snapshot: data.snapshot } } };
  });
  return { ...data, definitions, mainlines,
    overview: { ...guide.overview, repository: data.repository, snapshot: data.snapshot, source_digests: guide.source_digests },
    searchAliases: (guide.aliases ?? []).map(a => ({ ...a, snapshot: data.snapshot, source_digests: guide.source_digests,
      review: { actor: 'Codex', reason: '按冻结源码用途核对的检索别名；不确认业务能力或入口身份。' } })),
    guideRules: guide.rules ?? [],
  };
}
