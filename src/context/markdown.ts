import type { ContextPackage, EvidenceAnswer } from "./types.js";
import { validateEvidenceAnswer } from "./evidence-answer.js";

export function renderAnswerMarkdown(context: ContextPackage, answer: EvidenceAnswer): string {
  validateEvidenceAnswer(context, answer);
  const names = new Map(context.definitions.map((item) => [item.definition_key, `${item.file_path} :: ${item.qualified_name}`]));
  const safe = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]()<>#|]/g, "\\$&");
  const lines = ["# 源码理解结果", "", safe(answer.summary), "", `状态：${answer.status}；Coverage：${answer.coverage.status}；快照：${context.snapshot_id}`, "", "## 证据结论", ""];
  for (const finding of answer.findings) {
    lines.push(`- [${finding.basis_kinds.join(", ")}] ${safe(finding.text)}`);
    if (finding.fact_ids.length) lines.push(`  事实：${finding.fact_ids.join(", ")}`);
  }
  if (context.query_plan.paths.length) {
    lines.push("", "## 静态调用路径", "", "以下路径不等于实际执行，也不证明路径条件可满足。", "");
    for (const item of context.query_plan.paths) lines.push(`- ${item.definition_keys.map((key) => safe(names.get(key) ?? key)).join(" → ")}`);
  }
  lines.push("", "## 源码证据", "");
  for (const item of context.semantic_evidence.slice(0, 30)) lines.push(`- ${safe(item.file_path)}，UTF-8 字节 [${item.span.start_byte}, ${item.span.end_byte})；Evidence：${item.evidence_id}`);
  if (context.semantic_evidence.length > 30) lines.push("", "其余 Evidence 请用 JSON 格式展开。");
  if (answer.presentation) lines.push("", "## Codex 表述（未验证推断）", "", safe(answer.presentation.summary), "", ...answer.presentation.finding_texts.map((text) => `- ${safe(text)}`));
  lines.push("", "## 未确定与边界", "", ...answer.unknowns.map((text) => `- ${safe(text)}`));
  return lines.join("\n") + "\n";
}
