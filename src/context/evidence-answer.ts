import { canonicalHash, canonicalJson } from "../contract/hash.js";
import type { IndexState } from "../indexing/types.js";
import type { RuntimeObservationSet } from "../runtime/types.js";
import type { SemanticFact, SemanticOverlay } from "../semantic/types.js";
import type { ContextPackage, EvidenceAnswer, EvidenceFinding, QuestionIntent } from "./types.js";
import { ContextPackageError } from "./types.js";

export function buildContextPackage(input: {
  state: IndexState;
  overlay: SemanticOverlay;
  question: string;
  file_path?: string;
  definition_key?: string;
  runtime?: RuntimeObservationSet | null;
  max_facts?: number;
}): ContextPackage {
  if (input.overlay.snapshot_id !== input.state.snapshot_id) {
    throw new ContextPackageError("CONTEXT_SNAPSHOT_MISMATCH", "Context Package requires one matching Snapshot and Overlay");
  }
  const intent = classifyIntent(input.question);
  const definition = input.definition_key
    ? input.state.graph.definitions.find((item) => item.definition_key === input.definition_key) ?? null
    : input.file_path ? null : findDefinitionInQuestion(input.state, input.question);
  const filePath = input.file_path ?? definition?.file_path ?? findFileInQuestion(input.state, input.question);
  const relatedDefinitions = input.state.graph.definitions.filter((item) =>
    (filePath && item.file_path === filePath) || (definition && item.definition_key === definition.definition_key),
  );
  const definitionKeys = new Set(relatedDefinitions.map((item) => item.definition_key));
  const relatedRelations = input.state.graph.relations.filter((relation) =>
    endpointMatches(relation.source, filePath, definitionKeys) || endpointMatches(relation.target, filePath, definitionKeys),
  );
  const relationDefinitionKeys = new Set(relatedRelations.flatMap((relation) => [relation.source, relation.target]
    .flatMap((endpoint) => endpoint.kind === "definition" ? [endpoint.definition_key] : [])));
  const selectedDefinitions = input.state.graph.definitions
    .filter((item) => definitionKeys.has(item.definition_key) || relationDefinitionKeys.has(item.definition_key))
    .sort((left, right) => left.definition_key.localeCompare(right.definition_key));
  const allEvidence = new Map(input.overlay.evidence.map((item) => [item.evidence_id, item]));
  const maxFacts = Math.max(1, Math.min(input.max_facts ?? 160, 500));
  const facts = input.overlay.facts.filter((fact) =>
    subjectMatches(fact, filePath, definitionKeys, input.state) ||
    fact.evidence_ids.some((id) => allEvidence.get(id)?.file_path === filePath),
  ).sort((left, right) => factPriority(intent, left) - factPriority(intent, right) || left.fact_id.localeCompare(right.fact_id))
    .slice(0, maxFacts);
  const evidenceIds = new Set(facts.flatMap((fact) => fact.evidence_ids));
  const evidence = input.overlay.evidence.filter((item) => evidenceIds.has(item.evidence_id));
  const unknowns: string[] = [];
  if (!filePath && !definition) unknowns.push("未从问题中唯一识别文件或定义；请使用 --file-path 或 --definition-key。");
  if (facts.length === maxFacts) unknowns.push(`语义事实已按预算截断为 ${maxFacts} 条。`);
  if (input.overlay.coverage.status !== "complete") unknowns.push("Semantic Overlay Coverage 不完整，不能据此断言未出现的行为不存在。");
  if (facts.some((fact) => fact.basis.kind === "static_possible")) unknowns.push("部分调用或主线属于 static_possible，只表示静态上可能发生。");
  if (!input.runtime) unknowns.push("未提供运行时 Observation，本答案只说明静态可能路径，不代表实际执行过。");
  const withoutHash = {
    schema_version: 1 as const,
    repository_id: input.state.repository_id,
    snapshot_id: input.state.snapshot_id,
    question: input.question,
    intent,
    target: { file_path: filePath, definition_key: definition?.definition_key ?? input.definition_key ?? null },
    definitions: selectedDefinitions,
    structural_relations: relatedRelations.sort((left, right) => left.relation_key.localeCompare(right.relation_key)),
    semantic_facts: facts,
    semantic_evidence: evidence,
    runtime: input.runtime ?? null,
    coverage: input.overlay.coverage,
    unknowns,
  };
  return { ...withoutHash, package_hash: canonicalHash(withoutHash) };
}

export function answerContextPackage(context: ContextPackage): EvidenceAnswer {
  const grouped = new Map<string, SemanticFact[]>();
  for (const fact of context.semantic_facts) {
    const items = grouped.get(fact.kind) ?? [];
    items.push(fact);
    grouped.set(fact.kind, items);
  }
  const target = context.target.file_path ??
    context.definitions.find((item) => item.definition_key === context.target.definition_key)?.qualified_name ??
    "当前目标";
  const findings: EvidenceFinding[] = [];
  const entryFacts = grouped.get("entrypoint") ?? [];
  const callFacts = grouped.get("call_target") ?? [];
  const effectFacts = grouped.get("effect") ?? [];
  addFinding(findings, entryFacts, `入口：${describeFacts(entryFacts, "qualified_name")}。`);
  addFinding(findings, callFacts, `调用：${describeFacts(callFacts, "target_qualified_name", "call")}。`);
  addFinding(findings, effectFacts, `副作用：${describeFacts(effectFacts, "effect_kind")}。`);
  addFinding(findings, grouped.get("application_flow") ?? [], `合成 ${(grouped.get("application_flow") ?? []).length} 条静态应用主线。`);
  if (context.runtime) {
    const matched = context.runtime.observations.filter((item) => item.definition_key).length;
    findings.push({
      text: `本次 Execution 观测到 ${context.runtime.observations.length} 个 span，其中 ${matched} 个关联到源码定义；能力仍为 Candidate。`,
      fact_ids: [],
      evidence_ids: [],
      basis_kinds: ["runtime_observed"],
    });
  }
  const summary = `${target}：${context.definitions.length} 个相关定义，${context.structural_relations.length} 条结构关系，${context.semantic_facts.length} 条语义事实。`;
  const answer: EvidenceAnswer = {
    schema_version: 1,
    status: context.unknowns.length > 0 ? "partial" : "answered",
    intent: context.intent,
    summary,
    findings,
    coverage: context.coverage,
    unknowns: context.unknowns,
    package_hash: context.package_hash,
  };
  validateEvidenceAnswer(context, answer);
  return answer;
}

export function validateEvidenceAnswer(context: ContextPackage, answer: EvidenceAnswer): void {
  if (answer.package_hash !== context.package_hash) {
    throw new ContextPackageError("ANSWER_CONTEXT_MISMATCH", "Evidence Answer is not bound to this Context Package");
  }
  if (
    answer.intent !== context.intent ||
    canonicalJson(answer.coverage) !== canonicalJson(context.coverage) ||
    context.unknowns.some((unknown) => !answer.unknowns.includes(unknown)) ||
    (answer.unknowns.length > 0 && answer.status !== "partial")
  ) {
    throw new ContextPackageError("ANSWER_CONTEXT_MISMATCH", "Evidence Answer changed intent, Coverage or unknown state");
  }
  const factIds = new Set(context.semantic_facts.map((fact) => fact.fact_id));
  const evidenceIds = new Set(context.semantic_evidence.map((item) => item.evidence_id));
  const basisByFact = new Map(context.semantic_facts.map((fact) => [fact.fact_id, fact.basis.kind]));
  for (const finding of answer.findings) {
    if (finding.fact_ids.some((id) => !factIds.has(id)) || finding.evidence_ids.some((id) => !evidenceIds.has(id))) {
      throw new ContextPackageError("ANSWER_INVENTED_EVIDENCE", "Evidence Answer cites data outside its Context Package");
    }
    const allowedBasis = new Set<string>(finding.fact_ids.flatMap((id) => basisByFact.get(id) ?? []));
    if (context.runtime && finding.fact_ids.length === 0) allowedBasis.add("runtime_observed");
    if (finding.basis_kinds.some((basis) => !allowedBasis.has(basis))) {
      throw new ContextPackageError("ANSWER_AUTHORITY_ESCALATION", "Evidence Answer raises a claim above its cited basis");
    }
  }
}

function classifyIntent(question: string): QuestionIntent {
  if (/(影响|改动|波及|impact)/i.test(question)) return "impact_scope";
  if (/(调用路径|怎么调用|call path|调用链)/i.test(question)) return "call_path";
  if (/(入口|主线|entry|flow)/i.test(question)) return "entry_flow";
  return "file_role";
}

function findDefinitionInQuestion(state: IndexState, question: string) {
  const matches = state.graph.definitions.filter((item) =>
    question.includes(item.qualified_name) || question.includes(item.name),
  ).sort((left, right) => right.qualified_name.length - left.qualified_name.length);
  return matches[0] ?? null;
}

function findFileInQuestion(state: IndexState, question: string): string | null {
  const matches = state.graph.source_files.filter((item) =>
    question.includes(item.relative_path) || question.includes(item.relative_path.split("/").at(-1) ?? item.relative_path),
  ).sort((left, right) => right.relative_path.length - left.relative_path.length);
  return matches[0]?.relative_path ?? null;
}

function endpointMatches(endpoint: { kind: "source_file"; file_path: string } | { kind: "definition"; definition_key: string }, filePath: string | null, definitionKeys: Set<string>): boolean {
  return endpoint.kind === "source_file" ? endpoint.file_path === filePath : definitionKeys.has(endpoint.definition_key);
}

function subjectMatches(fact: SemanticFact, filePath: string | null, definitionKeys: Set<string>, state: IndexState): boolean {
  if (fact.subject.kind === "source_file") return fact.subject.file_path === filePath;
  const definitionKey = fact.subject.definition_key;
  if (definitionKeys.has(definitionKey)) return true;
  return state.graph.definitions.some((item) => item.definition_key === definitionKey && item.file_path === filePath);
}

function factPriority(intent: QuestionIntent, fact: SemanticFact): number {
  const order: Record<QuestionIntent, string[]> = {
    file_role: ["entrypoint", "application_flow", "call_target", "effect", "symbol_type", "control_step"],
    call_path: ["call_target", "application_flow", "entrypoint", "control_step", "effect", "symbol_type"],
    entry_flow: ["entrypoint", "application_flow", "call_target", "control_step", "effect", "symbol_type"],
    impact_scope: ["reference_target", "call_target", "import_target", "application_flow", "entrypoint", "symbol_type"],
  };
  const index = order[intent].indexOf(fact.kind);
  return index < 0 ? order[intent].length : index;
}

function addFinding(target: EvidenceFinding[], facts: SemanticFact[], text: string): void {
  if (facts.length === 0) return;
  target.push({
    text,
    fact_ids: facts.map((fact) => fact.fact_id),
    evidence_ids: [...new Set(facts.flatMap((fact) => fact.evidence_ids))],
    basis_kinds: [...new Set(facts.map((fact) => fact.basis.kind))],
  });
}

function describeFacts(facts: SemanticFact[], ...keys: string[]): string {
  const labels = facts.flatMap((fact) => {
    if (!fact.value || typeof fact.value !== "object" || Array.isArray(fact.value)) return [];
    for (const key of keys) {
      const value = (fact.value as Record<string, unknown>)[key];
      if (typeof value === "string" && value) return [value];
    }
    return [];
  });
  const unique = [...new Set(labels)].slice(0, 8);
  return unique.length > 0 ? unique.join("、") : `${facts.length} 项`;
}
