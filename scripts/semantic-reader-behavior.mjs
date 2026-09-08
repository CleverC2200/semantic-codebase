import { createReaderGraphModel } from './semantic-reader-graph.mjs';

// A presentation-only projection: merge only straight-line statements, never a condition or jump.
export function readerBehaviorSteps(data, key, model = createReaderGraphModel(data)) {
  const graph = model.controlGraph(key), definition = model.definitions.get(key);
  const file = data.files?.find(f => f.path === definition?.file_path);
  const bytes = file?.verified && typeof file.source === 'string' ? new TextEncoder().encode(file.source) : null;
  const decode = (a, b) => new TextDecoder().decode(bytes.subarray(a, b));
  const titles = { statement: '处理数据', branch: '判断条件', loop: '循环', return: '返回结果', throw: '抛出异常', await: '等待结果', condition: '判断条件', always: '继续循环', await_suspend: '等待异步结果', await_resume: '继续处理结果', break: '离开循环', continue: '进入下一轮', declaration: '建立声明', switch: '选择分支', exception_dispatch: '选择异常处理路径', context_exit: '退出上下文', unknown: '待核对步骤' };
  const descriptions = { statement: '执行所列语句，沿标出的去向继续。', branch: '按此条件选择成立或不成立的路径。', loop: '按迭代条件进入循环体或离开循环。', return: '返回此结果；后续仍以提取到的控制边为准。', throw: '抛出此异常；是否被捕获取决于后续异常路径。', await: '等待异步结果；拒绝和异常路径可能未完整提取。' };
  descriptions.condition = descriptions.branch;
  descriptions.await_suspend = descriptions.await;
  descriptions.await_resume = '静态表示等待结束后可能继续处理的路径，不代表本次已经执行。';
  const nodes = graph.nodes.filter(n => !['entry', 'exit'].includes(n.block.kind)).map(n => {
    const evidence = data.evidence?.[n.block.evidence_id], span = evidence?.span;
    const valid = bytes && evidence?.file_path === file.path && evidence.source_digest === file.source_digest &&
      (evidence.snapshot_id === undefined || evidence.snapshot_id === data.snapshot) && Number.isInteger(span?.start_byte) &&
      Number.isInteger(span?.end_byte) && span.start_byte >= 0 && span.end_byte >= span.start_byte && span.end_byte <= bytes.length;
    return { ...n, blockIds: [n.id], evidenceIds: [n.block.evidence_id].filter(Boolean), title: titles[n.block.kind] ?? '待核对步骤',
      description: descriptions[n.block.kind] ?? '核对此步骤及标出的后续路径；未提取部分保持未知。', inferred: false,
      source: valid ? decode(span.start_byte, span.end_byte) : null, sourcePosition: valid ? span.start_byte : null,
      sourceEnd: valid ? span.end_byte : null, sourceLine: valid ? decode(0, span.start_byte).split('\n').length : null };
  });
  if (nodes.every(n => n.sourcePosition !== null)) nodes.sort((a, b) => a.sourcePosition - b.sourcePosition);
  const groups = [], mapped = new Map();
  for (const node of nodes) {
    const previous = groups.at(-1), lastId = previous?.blockIds.at(-1);
    const outgoing = graph.edges.filter(e => e.from === lastId), incoming = graph.edges.filter(e => e.to === node.id);
    const merge = previous?.block.kind === 'statement' && node.block.kind === 'statement' && previous.blockIds.length < 3 &&
      previous.sourceEnd !== null && node.sourcePosition !== null && node.sourcePosition >= previous.sourceEnd &&
      /^\s*$/.test(decode(previous.sourceEnd, node.sourcePosition)) && outgoing.length === 1 && incoming.length === 1 &&
      outgoing[0].to === node.id && outgoing[0].raw.kind === 'next';
    if (merge) {
      previous.blockIds.push(node.id); previous.evidenceIds.push(...node.evidenceIds);
      previous.sourceEnd = node.sourceEnd; previous.source = decode(previous.sourcePosition, node.sourceEnd);
      mapped.set(node.id, previous.id);
    } else { groups.push(node); mapped.set(node.id, node.id); }
  }
  const exitIds = new Set(graph.nodes.filter(n => n.block.kind === 'exit').map(n => n.id));
  const edges = graph.edges.filter(e => mapped.has(e.from)).map(e => ({ ...e, from: mapped.get(e.from), to: mapped.get(e.to) ?? e.to, terminal: exitIds.has(e.to) }))
    .filter(e => e.from !== e.to || e.raw.kind !== 'next');
  return { ...graph, nodes: groups, edges, orientation: 'vertical', compact: groups.length <= 6, file: file?.path };
}
