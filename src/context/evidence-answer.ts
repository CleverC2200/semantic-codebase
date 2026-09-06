import { canonicalHash, canonicalJson } from "../contract/hash.js";
import type { IndexState } from "../indexing/types.js";
import type { RuntimeObservationSet } from "../runtime/types.js";
import type { SemanticFact, SemanticOverlay } from "../semantic/types.js";
import type { ContextPackage, EvidenceAnswer, EvidenceFinding, QuestionIntent } from "./types.js";
import { ContextPackageError } from "./types.js";
import { executeQueryPlan } from "./query-plan.js";
import type { ConfirmedCapability } from "../runtime/capability-registry.js";
import type { ControlFlowGraph } from "../semantic/control-flow.js";
import type { Access } from "../semantic/reaching-definitions.js";

export function buildContextPackage(input: {
  state: IndexState;
  overlay: SemanticOverlay;
  question: string;
  file_path?: string;
  definition_key?: string;
  runtime?: RuntimeObservationSet | null;
  max_facts?: number;
  capabilities?: ConfirmedCapability[];
  source_freshness?: "fresh" | "stale";
}): ContextPackage {
  if (input.overlay.snapshot_id !== input.state.snapshot_id) {
    throw new ContextPackageError("CONTEXT_SNAPSHOT_MISMATCH", "Context Package requires one matching Snapshot and Overlay");
  }
  if (input.runtime && (input.runtime.repository_id !== input.state.repository_id ||
      input.runtime.snapshot_id !== input.state.snapshot_id || input.runtime.semantic_overlay_hash !== input.overlay.overlay_hash)) {
    throw new ContextPackageError("CONTEXT_RUNTIME_MISMATCH", "Runtime must belong to this repository, Snapshot and Overlay");
  }
  const intent = classifyIntent(input.question);
  const definition = input.definition_key
    ? input.state.graph.definitions.find((item) => item.definition_key === input.definition_key) ?? null
    : input.file_path ? null : findDefinitionInQuestion(input.state, input.question);
  const filePath = input.file_path ?? definition?.file_path ?? findFileInQuestion(input.state, input.question);
  if (input.definition_key && !definition) throw new ContextPackageError("TARGET_NOT_FOUND", "Definition does not exist in this Snapshot");
  if (filePath && !input.state.graph.source_files.some((file) => file.relative_path === filePath)) throw new ContextPackageError("TARGET_NOT_FOUND", "File does not exist in this Snapshot");
  if (!definition && !filePath && intent !== "capability") throw new ContextPackageError("TARGET_REQUIRED", "Specify --file-path or --definition-key to disambiguate the question");
  const relatedDefinitions = input.state.graph.definitions.filter((item) =>
    definition ? item.definition_key === definition.definition_key : filePath && item.file_path === filePath,
  );
  const definitionKeys = new Set(relatedDefinitions.map((item) => item.definition_key));
  const queryTargetKeys = new Set(definitionKeys);
  const capabilities = (input.capabilities ?? []).filter((item) => item.repository_id === input.state.repository_id &&
    item.snapshot_id === input.state.snapshot_id && (!filePath && !definition || item.definition_keys.some((key) => definitionKeys.has(key))));
  if (intent === "capability") for (const capability of capabilities) for (const key of capability.definition_keys) definitionKeys.add(key);
  const plan = executeQueryPlan(intent, [...definitionKeys], input.overlay.facts);
  for (const key of plan.definition_keys) definitionKeys.add(key);
  const callerKeys = new Set(input.overlay.facts.flatMap((fact) => {
    if (fact.kind !== "call_target" || fact.subject.kind !== "definition") return [];
    const target = (fact.value as { target_definition_key?: unknown }).target_definition_key;
    return typeof target === "string" && queryTargetKeys.has(target) ? [fact.subject.definition_key] : [];
  }));
  const callerFlowFacts = input.overlay.facts.filter((fact) =>
    ["call_path", "data_flow"].includes(intent) && fact.kind === "call_data_flow" &&
    fact.subject.kind === "definition" && callerKeys.has(fact.subject.definition_key));
  const callerFlowTargetKeys = new Set(callerFlowFacts.flatMap((fact) => {
    const target = (fact.value as { target_definition_key?: unknown }).target_definition_key;
    return typeof target === "string" ? [target] : [];
  }));
  const callerContextFacts = input.overlay.facts.filter((fact) => ["call_path", "data_flow"].includes(intent) &&
    fact.subject.kind === "definition" && callerKeys.has(fact.subject.definition_key) &&
    (fact.kind === "data_flow" || intent === "call_path" && ["call_target", "control_flow", "application_flow", "effect"].includes(fact.kind)));
  const callerContextTargetKeys = new Set(callerContextFacts.flatMap((fact) => {
    if (fact.kind !== "call_target") return [];
    const target = (fact.value as { target_definition_key?: unknown }).target_definition_key;
    return typeof target === "string" ? [target] : [];
  }));
  const callerContextIds = new Set(callerContextFacts.map((fact) => fact.fact_id));
  const relatedRelations = input.state.graph.relations.filter((relation) =>
    endpointMatches(relation.source, definition ? null : filePath, definitionKeys) ||
    endpointMatches(relation.target, definition ? null : filePath, definitionKeys),
  );
  const relationDefinitionKeys = new Set(relatedRelations.flatMap((relation) => [relation.source, relation.target]
    .flatMap((endpoint) => endpoint.kind === "definition" ? [endpoint.definition_key] : [])));
  const selectedDefinitions = input.state.graph.definitions
    .filter((item) => definitionKeys.has(item.definition_key) || relationDefinitionKeys.has(item.definition_key) ||
      callerFlowTargetKeys.has(item.definition_key) || callerContextTargetKeys.has(item.definition_key))
    .sort((left, right) => left.definition_key.localeCompare(right.definition_key));
  const allEvidence = new Map(input.overlay.evidence.map((item) => [item.evidence_id, item]));
  const maxFacts = Math.max(1, Math.min(input.max_facts ?? 160, 500));
  const plannedIds = new Set([...plan.edges.map((edge) => edge.fact_id), ...plan.selected_fact_ids]);
  const seedKeys = new Set(plan.seeds);
  // Keep the queried function's direct calls, including unresolved imports, before
  // expanding downstream. This is presentation priority, not a certainty upgrade.
  const seedCallPriority = (fact: SemanticFact): number => {
    if (intent !== "call_path" || fact.kind !== "call_target" || fact.subject.kind !== "definition" || !seedKeys.has(fact.subject.definition_key)) return 2;
    return /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u.test(String((fact.value as { call?: unknown }).call ?? "")) ? 0 : 1;
  };
  const seedContextPriority = (fact: SemanticFact): number => {
    if (maxFacts <= 2) return seedCallPriority(fact);
    if (intent === "behavior") {
      const seed = fact.subject.kind === "definition" && seedKeys.has(fact.subject.definition_key);
      if (seed && fact.kind === "control_flow") return 0;
      if (seed && fact.kind === "effect") return 1;
      if (plannedIds.has(fact.fact_id) && fact.kind === "effect") return 2;
      if (plannedIds.has(fact.fact_id) && fact.kind === "control_flow") return 3;
      if (seed && fact.kind === "call_target") return 4;
      return 6;
    }
    const seed = fact.subject.kind === "definition" && seedKeys.has(fact.subject.definition_key);
    if (intent === "call_path") {
      const controlEffect = fact.kind === "effect" && ["return", "throw", "raise", "yield", "await", "break", "continue"]
        .includes(String((fact.value as { effect_kind?: unknown }).effect_kind ?? ""));
      if (seed && fact.kind === "control_flow") return 0;
      if (seed && fact.kind === "effect") return 1;
      if (!seed && fact.kind === "effect" && !controlEffect) return 2;
      if (callerContextIds.has(fact.fact_id) && fact.kind === "control_flow") return 3;
      if (seed && fact.kind === "call_target") return 4 + seedCallPriority(fact);
      if (fact.kind === "call_target" && fact.subject.kind === "definition" &&
          (definitionKeys.has(fact.subject.definition_key) || callerKeys.has(fact.subject.definition_key))) return 5;
      if (callerContextIds.has(fact.fact_id)) return 6;
      if (seed) return 7;
      return 8;
    }
    if (seed && fact.kind === "control_flow") return 0;
    if (seed && fact.kind === "effect") return 1;
    if (seed && fact.kind === "data_flow") return 2;
    if (seed && fact.kind === "application_flow") return 3;
    if (callerContextIds.has(fact.fact_id) && fact.kind === "control_flow") return 3;
    if (seed && fact.kind === "call_target") return 4 + seedCallPriority(fact);
    if (callerContextIds.has(fact.fact_id)) return 6;
    if (seed) return 7;
    return 8;
  };
  const eligibleFacts = input.overlay.facts.filter((fact) =>
    subjectMatches(fact, definition ? null : filePath, definitionKeys, input.state) ||
    callerFlowFacts.some((item) => item.fact_id === fact.fact_id) ||
    callerContextIds.has(fact.fact_id) ||
    (!definition && fact.evidence_ids.some((id) => allEvidence.get(id)?.file_path === filePath)),
  ).sort((left, right) => seedContextPriority(left) - seedContextPriority(right) || Number(plannedIds.has(right.fact_id)) - Number(plannedIds.has(left.fact_id)) || factPriority(intent, left) - factPriority(intent, right) || left.fact_id.localeCompare(right.fact_id));
  const countTruncated = eligibleFacts.length > maxFacts;
  let facts = eligibleFacts.slice(0, maxFacts);
  // Count serialized content, not just rows: a single flow can contain a large graph.
  let byteCount = 0;
  let byteTruncated = false;
  const budgetEvidence = new Set<string>();
  facts = facts.filter((fact) => {
    const ids = fact.evidence_ids.filter((id) => !budgetEvidence.has(id));
    const size = Buffer.byteLength(canonicalJson(fact)) + ids.reduce((sum, id) => sum + Buffer.byteLength(canonicalJson(allEvidence.get(id)!)), 0);
    if (byteCount + size > 131072) { byteTruncated = true; return false; }
    byteCount += size; for (const id of ids) budgetEvidence.add(id); return true;
  });
  const retainedIds = new Set(facts.map((fact) => fact.fact_id));
  if (countTruncated || byteTruncated) plan.truncated = true;
  if (plan.edges.some((edge) => !retainedIds.has(edge.fact_id))) plan.truncated = true;
  plan.edges = plan.edges.filter((edge) => retainedIds.has(edge.fact_id));
  if (plan.selected_fact_ids.some((id) => !retainedIds.has(id))) plan.truncated = true;
  plan.selected_fact_ids = plan.selected_fact_ids.filter((id) => retainedIds.has(id));
  plan.paths = plan.paths.filter((path) => path.fact_ids.every((id) => retainedIds.has(id)));
  const evidenceIds = new Set(facts.flatMap((fact) => fact.evidence_ids));
  const evidence = input.overlay.evidence.filter((item) => evidenceIds.has(item.evidence_id));
  const unknowns: string[] = [];
  if (byteTruncated) unknowns.push("语义事实与 Evidence 达到 128 KiB 内容预算；较大事实已省略。");
  if (input.runtime?.coverage.reason_codes.includes("trace_source_binding_unverified")) unknowns.push("Trace 未声明源码快照；文件与名称匹配不证明执行的是当前源码版本。");
  if (input.source_freshness === "stale") unknowns.push("源码已变化，答案仅描述旧快照；请 sync 后重新 semantic build。");
  if (intent === "capability" && !capabilities.length) unknowns.push("当前范围没有人工确认能力；不能把入口候选当作已确认业务功能。");
  if (intent === "impact_scope") unknowns.push("当前影响范围按静态调用依赖计算，未穷举共享状态、配置或运行时依赖。");
  if (plan.truncated) unknowns.push("查询计划或上下文达到深度、节点、边或内容预算，影响范围和调用链不完整。");
  if (!filePath && !definition) unknowns.push("未从问题中唯一识别文件或定义；请使用 --file-path 或 --definition-key。");
  if (countTruncated) unknowns.push(`语义事实已按预算截断为 ${maxFacts} 条。`);
  if (input.overlay.coverage.status !== "complete") unknowns.push("Semantic Overlay Coverage 不完整，不能据此断言未出现的行为不存在。");
  if (facts.some((fact) => fact.basis.kind === "static_possible")) unknowns.push("部分调用或主线属于 static_possible，只表示静态上可能发生。");
  if (!input.runtime) unknowns.push("未提供运行时 Observation，本答案只说明静态可能路径，不代表实际执行过。");
  const withoutHash = {
    schema_version: 1 as const,
    repository_id: input.state.repository_id,
    snapshot_id: input.state.snapshot_id,
    question: input.question,
    intent,
    query_plan: plan,
    target: { file_path: filePath, definition_key: definition?.definition_key ?? input.definition_key ?? null },
    definitions: selectedDefinitions,
    structural_relations: relatedRelations.sort((left, right) => left.relation_key.localeCompare(right.relation_key)),
    semantic_facts: facts,
    semantic_evidence: evidence,
    runtime: input.runtime ?? null,
    capabilities,
    coverage: input.overlay.coverage,
    unknowns,
  };
  if (Buffer.byteLength(canonicalJson(withoutHash)) > 1048576) throw new ContextPackageError("CONTEXT_BUDGET_EXCEEDED", "Context exceeds 1 MiB total budget; narrow the file or definition scope");
  return { ...withoutHash, package_hash: canonicalHash(withoutHash) };
}

export function answerContextPackage(context: ContextPackage): EvidenceAnswer {
  const answer = renderEvidenceAnswer(context);
  validateEvidenceAnswer(context, answer);
  return answer;
}

function renderEvidenceAnswer(context: ContextPackage): EvidenceAnswer {
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
  for (const capability of context.capabilities) findings.push({ text: `人工确认能力：${capability.title}（${capability.members.length} 个候选来源；仅适用于当前快照）。`,
    fact_ids: [], evidence_ids: [], basis_kinds: ["human_confirmed"], capability_ids: [capability.capability_id] });
  if (context.intent === "data_flow") addFinding(findings, grouped.get("data_flow") ?? [], `函数内数据依赖：${(grouped.get("data_flow") ?? []).length} 份 def-use 结果；跨过程映射见 call_data_flow，未覆盖范围见 unknown。`);
  if (["data_flow", "entry_flow"].includes(context.intent)) for (const fact of (grouped.get("call_data_flow") ?? []).slice(0, 12)) {
    const value = fact.value as unknown as { target_definition_key: string | null; depth: number;
      bindings?: { argument_expression: string | null; parameter_name: string | null }[];
      mappings: { parameter_name?: string; result_binding?: string | null }[] };
    const name = context.definitions.find((item) => item.definition_key === value.target_definition_key)?.qualified_name ?? "未解析被调函数";
    if (value.bindings?.length) addFinding(findings, [fact], `调用参数绑定到 ${name}：${value.bindings.slice(0, 8).map((item) => `${JSON.stringify(item.argument_expression)} → 形参 ${item.parameter_name}`).join("；")}。只说明传参，不证明返回值依赖全部参数。`);
    if (value.mappings.length) addFinding(findings, [fact], `${name} 的跨函数返回依赖（分析上限 ${value.depth} 层）：${value.mappings.slice(0, 8).map((item) => `形参 ${item.parameter_name ?? "见证据"} → 返回值 → ${item.result_binding ? `接收变量 ${item.result_binding}` : "调用表达式（未绑定局部变量）"}`).join("；")}；属于静态值依赖，不是数值相等或完整堆传播。`);
    else addFinding(findings, [fact], `${name}：尚无可发布的参数到返回值依赖；不能据此断言函数不依赖参数。`);
  }
  if (["call_path", "data_flow", "entry_flow"].includes(context.intent)) {
    const names = new Map(context.definitions.map((item) => [item.definition_key, item.qualified_name]));
    const flows = grouped.get("call_data_flow") ?? [];
    for (const producer of flows) {
      if (producer.subject.kind !== "definition") continue;
      const produced = producer.value as unknown as { target_definition_key?: string; mappings?: { result_binding?: string | null; caller_result_binding_evidence_id?: string | null }[] };
      for (const mapping of produced.mappings ?? []) {
        if (!mapping.result_binding) continue;
        for (const consumer of flows) {
          if (consumer.fact_id === producer.fact_id || consumer.subject.kind !== "definition" ||
              consumer.subject.definition_key !== producer.subject.definition_key) continue;
          const consumed = consumer.value as unknown as { target_definition_key?: string; bindings?: { argument_expression?: string | null; parameter_name?: string | null; argument_evidence_id?: string }[] };
          for (const binding of consumed.bindings ?? []) {
            if (binding.argument_expression !== mapping.result_binding) continue;
            // A same-named variable may have been overwritten or belong to a
            // different lexical binding. Require a unique reaching definition.
            const callerData = (grouped.get("data_flow") ?? []).find((fact) => fact.subject.kind === "definition" &&
              producer.subject.kind === "definition" && fact.subject.definition_key === producer.subject.definition_key);
            if (!callerData || !mapping.caller_result_binding_evidence_id || !binding.argument_evidence_id) continue;
            const data = callerData.value as unknown as { converged: boolean; unknowns: string[]; accesses: Access[]; links: { definition: number; use: number }[] };
            if (!data.converged || data.unknowns.includes("parameter_return_summary_withheld")) continue;
            const resultDefinition = data.accesses.find((access) => access.kind === "definition" && access.evidence_id === mapping.caller_result_binding_evidence_id);
            const argumentUse = data.accesses.find((access) => access.kind === "use" && access.evidence_id === binding.argument_evidence_id);
            if (!resultDefinition || !argumentUse) continue;
            const reaching = data.links.filter((link) => link.use === argumentUse.id);
            if (reaching.length !== 1 || reaching[0]!.definition !== resultDefinition.id) continue;
            addFinding(findings, [producer, consumer, callerData], `跨函数值传播：${names.get(produced.target_definition_key ?? "") ?? "上游函数"} 返回结果由 ${names.get(producer.subject.definition_key) ?? "调用者"} 接收为 ${mapping.result_binding}，随后作为 ${names.get(consumed.target_definition_key ?? "") ?? "下游函数"}.${binding.parameter_name ?? "参数"} 参数传入。`);
          }
        }
      }
    }
  }
  if (context.intent === "behavior") addFinding(findings, grouped.get("control_flow") ?? [], `条件与异常分支：${(grouped.get("control_flow") ?? []).length} 份控制流图；仅表示静态可能路径。`);
  if (["behavior", "data_flow", "entry_flow", "call_path"].includes(context.intent)) {
    const flows = grouped.get("control_flow") ?? [];
    for (const fact of flows.slice(0, 6)) {
      const graph = fact.value as unknown as ControlFlowGraph;
      const name = context.definitions.find((item) => fact.subject.kind === "definition" && item.definition_key === fact.subject.definition_key)?.qualified_name ?? "目标";
      const positions = new Map(context.semantic_evidence.map((item) => [item.evidence_id, item.span.start_byte]));
      const visible = graph.blocks.filter((block) => block.source_excerpt && block.kind !== "entry" && block.kind !== "exit")
        .sort((left, right) => (positions.get(left.evidence_id) ?? 0) - (positions.get(right.evidence_id) ?? 0) || left.id - right.id);
      // Block IDs are graph addresses, not execution sequence numbers.
      const labels = visible.slice(0, 12).map((block) => {
        const kind = ({ condition: "条件/迭代", return: "返回", throw: "抛出", statement: "语句" } as Record<string, string>)[block.kind] ?? block.kind;
        const edges = graph.edges.filter((edge) => edge.from === block.id).map((edge) => `${edge.kind} → #${edge.to}`).join(", ");
        return `#${block.id} ${kind} ${JSON.stringify(block.source_excerpt)}${edges ? `（${edges}）` : ""}`;
      });
      if (labels.length) addFinding(findings, [fact], `${name} 的静态源码片段（节点号不是执行顺序）：${labels.join("；")}${visible.length > 12 ? "；片段已截断，其余见 control_flow" : ""}。`);
    }
    if (flows.length > 6) addFinding(findings, flows.slice(6), "其余函数控制流未在摘要展开，请查看 Context Package。");
  }
  if (context.intent === "call_path" || context.intent === "impact_scope") {
    const names = new Map(context.definitions.map((definition) => [definition.definition_key, definition.qualified_name]));
    const edges = context.query_plan.edges;
    const selected = new Set(edges.map((edge) => edge.fact_id));
    addFinding(findings, context.semantic_facts.filter((fact) => selected.has(fact.fact_id)),
      `${context.intent === "impact_scope" ? "上游影响连接" : "下游调用连接"}：${edges.slice(0, 12).map((edge) => `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}`).join("；")}${edges.length > 12 ? "；其余见查询计划" : ""}。`);
  }
  const entryFacts = grouped.get("entrypoint") ?? [];
  const callFacts = grouped.get("call_target") ?? [];
  const effectFacts = grouped.get("effect") ?? [];
  const controlKinds = new Set(["return", "throw", "raise", "yield", "await", "break", "continue"]);
  const isControl = (fact: SemanticFact) => controlKinds.has((fact.value as { effect_kind: string }).effect_kind);
  addFinding(findings, entryFacts, `入口：${describeFacts(entryFacts, "qualified_name")}。`);
  addFinding(findings, callFacts, `调用：${describeFacts(callFacts, "target_qualified_name", "call")}。`);
  const controlFacts = effectFacts.filter(isControl);
  const sideEffectFacts = effectFacts.filter((fact) => !isControl(fact));
  addFinding(findings, controlFacts, `控制转移：${describeFacts(controlFacts, "effect_kind")}。`);
  addFinding(findings, sideEffectFacts, `副作用：${describeFacts(sideEffectFacts, "effect_kind")}。`);
  for (const fact of sideEffectFacts.filter((item) => typeof (item.value as { operation?: unknown }).operation === "string").slice(0, 12)) {
    const value = fact.value as { effect_kind: string; operation: string };
    addFinding(findings, [fact], `副作用位置（${value.effect_kind}，${fact.basis.kind}）：${JSON.stringify(value.operation)}；是否发生取决于控制路径。`);
  }
  addFinding(findings, grouped.get("application_flow") ?? [], `合成 ${(grouped.get("application_flow") ?? []).length} 条静态应用主线。`);
  if (context.runtime) {
    const matched = context.runtime.observations.filter((item) => item.definition_key).length;
    findings.push({
      text: `本次 Execution 观测到 ${context.runtime.observations.length} 个 span，其中 ${matched} 个关联到源码定义；未经人工确认的能力仍为 Candidate。`,
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
  return answer;
}

export function validateEvidenceAnswer(context: ContextPackage, answer: EvidenceAnswer): void {
  if (answer.presentation && (answer.presentation.basis !== "llm_inferred" || answer.presentation.verified !== false)) {
    throw new ContextPackageError("ANSWER_AUTHORITY_ESCALATION", "Model presentation must remain unverified inference");
  }
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
    if (finding.capability_ids?.some((id) => !context.capabilities.some((item) => item.capability_id === id))) {
      throw new ContextPackageError("ANSWER_INVENTED_EVIDENCE", "Unknown confirmed capability");
    }
    if (finding.capability_ids?.length) allowedBasis.add("human_confirmed");
    if (context.runtime && finding.fact_ids.length === 0) allowedBasis.add("runtime_observed");
    if (finding.basis_kinds.some((basis) => !allowedBasis.has(basis))) {
      throw new ContextPackageError("ANSWER_AUTHORITY_ESCALATION", "Evidence Answer raises a claim above its cited basis");
    }
  }
  const expected = renderEvidenceAnswer(context);
  if (answer.summary !== expected.summary || canonicalJson(answer.findings) !== canonicalJson(expected.findings)) {
    throw new ContextPackageError("ANSWER_UNVERIFIED_CLAIM", "Authoritative findings must be rendered from structured facts; free prose is not verified evidence");
  }
}

function classifyIntent(question: string): QuestionIntent {
  if (/(数据.*(哪|来|变|写|流)|data flow|数据流)/i.test(question)) return "data_flow";
  if (/(条件|异常|副作用|分支|behavior)/i.test(question)) return "behavior";
  if (/(影响|改动|波及|impact)/i.test(question)) return "impact_scope";
  if (/(调用路径|怎么调用|call path|调用链)/i.test(question)) return "call_path";
  if (/(入口|主线|entry|flow)/i.test(question)) return "entry_flow";
  if (/(功能.*(如何|怎么).*实现)/i.test(question)) return "entry_flow";
  if (/(能力|提供.*功能|capabilit)/i.test(question)) return "capability";
  if (/(文件|作用|职责|包含|做什么|介绍|概览|说明|解释|file|role)/i.test(question)) return "file_role";
  throw new ContextPackageError("UNSUPPORTED_QUESTION", "Question cannot be mapped to a supported semantic query intent");
}

function findDefinitionInQuestion(state: IndexState, question: string) {
  const matches = state.graph.definitions.flatMap((item) => {
    const names = [item.qualified_name, item.name].filter((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(question);
    });
    return names.length ? [{ item, score: Math.max(...names.map((name) => name.length)) }] : [];
  }).sort((a, b) => b.score - a.score);
  if (matches.length > 1 && matches[0]!.score === matches[1]!.score) throw new ContextPackageError("AMBIGUOUS_TARGET", "Multiple definitions match; specify --file-path or --definition-key");
  return matches[0]?.item ?? null;
}

function findFileInQuestion(state: IndexState, question: string): string | null {
  const matches = state.graph.source_files.filter((item) =>
    question.includes(item.relative_path) || question.includes(item.relative_path.split("/").at(-1) ?? item.relative_path),
  ).sort((left, right) => right.relative_path.length - left.relative_path.length);
  const exact = matches.filter((item) => question.includes(item.relative_path));
  const candidates = exact.length ? exact : matches;
  if (candidates.length > 1) throw new ContextPackageError("AMBIGUOUS_TARGET", "Multiple files match; specify their full repository-relative path");
  return candidates[0]?.relative_path ?? null;
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
    capability: ["entrypoint", "application_flow", "effect"],
    data_flow: ["data_flow", "call_data_flow", "call_target", "effect"],
    behavior: ["control_flow", "effect", "call_target"],
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
