# Semantic Enrichment Contract Spec

状态：Accepted

版本：0.1

适用阶段：Semantic Codebase 全能力 V0

依赖：[Structural Graph Productization Spec](structural-graph-productization.md)

领域词汇：[CONTEXT.md](../../CONTEXT.md)

决策来源：[定义语义事实的权威层级与统一 Enricher Contract](https://github.com/CleverC2200/semantic-codebase/issues/24)

## 1. 决策摘要

V0 在现有 Ready Snapshot 之上增加不可变 `Semantic Overlay`，不修改 Structural Graph，也不允许任何 Semantic Enricher 直接写 Store、切换 Ready pointer 或构造 Canonical Fact/Relation。

公共 Module 只暴露一个行为入口：

```ts
interface SemanticEnrichmentModule {
  enrich(base: ReadyStructuralSnapshotRef): Promise<EnrichmentStagingBatch>;
}
```

调用者只提供 Ready Structural Snapshot。Enrichment Profile 在 Module 创建时冻结；具体 Adapter、依赖 DAG、预算、Evidence 规范化、逐波准入和确定性排序全部隐藏在 Implementation 中。

所有语义断言保留不可改写的 `Claim Basis`：

- `compiler_exact`；
- `static_possible`；
- `framework_heuristic`；
- `runtime_observed`；
- `llm_inferred`。

这五类是不同认识来源，不是一条 confidence 数轴。多个弱来源一致不能自动升级；Runtime Observation 和 LLM inference 永远不能成为静态权威事实。

## 2. 目标与成功标准

### 2.1 目标

本 Contract 应使后续 TypeScript Compiler、Pyright、CallSite、CFG、Data Flow、Effect 和 Framework 分析共享同一个深 Module，同时保持：

1. Ready Snapshot 不可变；
2. Canonicalizer 是正式语义结果的唯一准入入口；
3. Adapter 不能自行获得权威；
4. 每项结果都能回链 Evidence；
5. Coverage 缺口不能被误解为不存在；
6. 新增 Adapter 不要求修改调用者 Interface；
7. Runtime 与 AI 可以复用来源和 Evidence 词汇，但不能混入静态权威层。

### 2.2 成功标准

- 调用者只学习 `SemanticEnrichmentModule.enrich()` 一个动作；
- 至少 TypeScript、Python、Behavior 和 Framework 四类 Adapter 可通过内部同一 Interface 接入；
- Enricher 只能创建本地 Draft ID，不能创建 Canonical ID；
- 未注册 Schema、未授权 Claim Basis、跨 Snapshot 引用或 Evidence 断链均不能发布；
- required 能力 Coverage 不完整时不发布新 Overlay；
- optional 能力部分完成时保留局部肯定结果和明确 Coverage；
- 相同冻结输入和版本的确定性分析产生相同规范输出与 hash；
- 构建失败不改变已有 Ready Snapshot 或已发布 Overlay；
- 旧 Overlay 不能绑定到不同 Snapshot；
- Runtime Observation 和 LLM inference 无法通过该 Interface 写入 Semantic Overlay。

## 3. 范围

### 3.1 V0 范围

- 绑定单个 Ready Structural Snapshot 的 Semantic Overlay；
- 版本化 Fact/Object Schema Registry；
- Enricher Manifest 与 Enrichment Profile；
- 内部 Adapter DAG 和逐波 Enrichment Admission；
- typed Semantic Object、Claim、Evidence、Coverage、Diagnostic；
- exact、possible、heuristic 三类静态 staging 结果；
- 与 Runtime Observation、LLM inference 的共享来源约束和隔离规则；
- 规范序列化、确定性 ID/hash、失败关闭和原子发布前置条件。

### 3.2 非目标

- 本 Spec 不选择 TypeScript Compiler API、Pyright 或具体框架；
- 不定义 CallSite、CFG、Data Flow、Effect、Application Flow 的完整 payload；
- 不定义 SQLite 表、migration、增量失效或清理策略；
- 不定义 Trace 采集协议；
- 不定义 Codex Prompt、Query Plan 或答案渲染；
- 不允许未注册的任意 JSON Fact；
- 不引入 confidence、Adapter 优先级或多数投票；
- 不建设远程 Analyzer 调度平台或通用工作流引擎。

## 4. 权威模型

### 4.1 五类 Claim Basis

| Claim Basis | 能证明什么 | 发布位置 | 能否成为静态权威事实 |
|---|---|---|---|
| `compiler_exact` | 在固定 Snapshot、配置、工具和规则语义下可重复证明的结论 | Semantic Overlay | 通过完整准入后可以 |
| `static_possible` | 静态分析得到的 may-set、可能可达或候选目标 | Semantic Overlay 的 possibility ledger | 不可以 |
| `framework_heuristic` | 版本化框架规则对约定模式的解释 | Semantic Overlay 的 heuristic ledger | 不可以 |
| `runtime_observed` | 指定 Execution 的观测范围内确实发生 | 独立 Observation Set | 不可以 |
| `llm_inferred` | AI 针对指定 Request Bundle 提出的推断 | Query/Answer artifact | 不可以 |

`compiler_exact` 的“exact”只在其声明的语义范围内成立。它不表示仓库完整、运行时必然发生，也不自动允许穷举或否定结论。

### 4.2 偏序而非等级

以下推理全部禁止：

- 多个 `static_possible` 一致，所以升级为 exact；
- 多次 Runtime Observation 一致，所以证明所有执行都会发生；
- LLM 正确复述编译器结果，所以把 LLM assertion 改为 exact；
- Framework heuristic 分数很高，所以写入 Structural Relation；
- optional Adapter 未发现结果，所以断言结果不存在。

更强证明必须产生一条新的 assertion，并保留原 assertion：

```text
static_possible assertion
        +
新的独立 compiler proof
        ↓
新的 compiler_exact assertion
```

## 5. Module 与 Seam

```text
Ready Structural Snapshot
          │
          ▼
┌──────────────────────────────────┐
│ Semantic Enrichment Module       │
│ Profile / DAG / budgets          │
│ → Adapter wave                   │
│ → Enrichment Admission           │
│ → accepted intermediate view     │
│ → next wave → staging batch      │
└──────────────────────────────────┘
          │ EnrichmentStagingBatch
          ▼
┌──────────────────────────────────┐
│ Semantic Overlay Canonicalizer   │
│ registry / merge / invariants    │
└──────────────────────────────────┘
          │ Canonical Overlay
          ▼
┌──────────────────────────────────┐
│ Index / Store publication        │
│ integrity check / atomic pointer │
└──────────────────────────────────┘
```

### 5.1 外部 Seam

```ts
export interface ReadyStructuralSnapshotRef {
  repository_id: string;
  snapshot_id: string;
  structural_graph_hash: string;
  source_manifest_digest: string;
  canonical_ir_version: string;
  adapter_profile_digest: string;
}

export interface SemanticEnrichmentModule {
  enrich(base: ReadyStructuralSnapshotRef): Promise<EnrichmentStagingBatch>;
}
```

Interface 不变量：

- `base` 必须指向完整、可读且 hash 一致的 Ready Snapshot；
- Module 只读取 Snapshot Manifest 中的 material；
- 调用期间发生的工作目录变化不能进入本次结果；
- 返回结果尚未获得发布权；
- Contract 破坏时 reject，预期分析缺口通过 Coverage/Diagnostic 返回；
- 取消或失败不得产生部分发布副作用。

### 5.2 内部 Adapter Seam

内部存在真实工具 Adapter 与 fixture Adapter 两种实现，因此该 Seam 是真实的；它不暴露给 Index/CLI/MCP 调用者。

```ts
export interface SemanticEnricherAdapter {
  readonly manifest: EnricherManifest;
  run(context: FrozenAnalysisView): Promise<EnrichmentSlice>;
}
```

Adapter 不调用下一个 Adapter。Module 根据 Profile 的 capability dependency 构造 DAG，按 wave 调度。

### 5.3 Implementation 必须隐藏的复杂度

- TypeScript Program、SourceFile、Node、Symbol、Type 和 checker cache；
- Pyright program、import resolver、type tracker 和内部对象；
- CFG/SSA/PDG 节点、worklist、lattice 与 fixpoint cache；
- Framework 规则引擎和框架原生对象；
- 冻结源码的安全物化与工具进程生命周期；
- 工具位置到 Snapshot file/span/Definition Key 的回映射；
- Adapter DAG、预算、取消、超时与资源清理；
- Evidence 去重、规范排序、本地 ID 与 hash；
- Schema 校验、冲突检测和内部 admission；
- SQLite、事务、migration 和 Ready pointer。

不得隐藏且必须穿过 Interface 的信息：Snapshot identity、Schema、原始 Claim Basis、Evidence、Coverage、Diagnostic、实际 Adapter/工具/规则版本。

## 6. Manifest 与 Profile

### 6.1 Enricher Manifest

```ts
export interface CapabilityRef {
  id: string;
  version: string;
}

export interface EnricherManifest {
  id: string;
  version: string;
  languages: readonly string[];
  engine: { id: string; version: string };
  config_digest: string;
  deterministic: boolean;
  requires: readonly CapabilityRef[];
  provides: readonly CapabilityRef[];
  emitted_schema_ids: readonly string[];
  emitted_basis_kinds: readonly ClaimBasis["kind"][];
}
```

Manifest 是 Adapter 的自我声明，不是信任来源。

### 6.2 Enrichment Profile

```ts
export interface EnrichmentBudget {
  max_duration_ms: number;
  max_source_bytes: number;
  max_claims: number;
  max_memory_bytes?: number;
}

export interface AdapterProfileBinding {
  adapter_id: string;
  manifest_digest: string;
  required: boolean;
  allowed_schema_ids: readonly string[];
  allowed_basis_kinds: readonly ClaimBasis["kind"][];
  budget: EnrichmentBudget;
}

export interface EnrichmentProfile {
  id: string;
  version: string;
  bindings: readonly AdapterProfileBinding[];
  schema_registry_digest: string;
  rule_registry_digest: string;
  profile_digest: string;
}
```

Profile 是信任根。它必须在 Module 创建时冻结，并进入 batch 与 Overlay identity。运行时不得由 Adapter 承诺能力或扩大权限。

Profile 必须满足：

- 每个 binding 唯一；
- Manifest digest 精确匹配；
- capability dependency 可满足且无环；
- Schema、Claim Basis 和 budget 均显式声明；
- required/optional 不得在运行期间改变；
- Runtime 与 LLM Adapter 不得绑定到静态 Overlay Profile。

## 7. 冻结输入

```ts
export interface FrozenMaterialDescriptor {
  material_id: string;
  kind: "source" | "config" | "analysis_artifact";
  relative_path?: string;
  digest: string;
  byte_length: number;
}

export interface FrozenMaterialReader {
  list(): readonly FrozenMaterialDescriptor[];
  read(material_id: string): Promise<Uint8Array>;
}

export interface CanonicalSemanticObject {
  object_key: string;
  snapshot_id: string;
  schema_id: string;
  value: CanonicalValue;
  evidence_ids: readonly string[];
}

export interface CanonicalSemanticClaim {
  claim_key: string;
  snapshot_id: string;
  schema_id: string;
  subject: AnalysisRef;
  value: CanonicalValue;
  basis: ClaimBasis;
  evidence_ids: readonly string[];
}

export interface FrozenAnalysisView {
  base: ReadyStructuralSnapshotRef;
  structural: Readonly<CanonicalGraph>;
  admitted_objects: readonly CanonicalSemanticObject[];
  admitted_claims: readonly CanonicalSemanticClaim[];
  materials: FrozenMaterialReader;
  execution: {
    run_id: string;
    binding: Readonly<AdapterProfileBinding>;
    signal: AbortSignal;
  };
}
```

规则：

- Material Reader 只能列出和读取 Snapshot 已登记内容；
- 每次读取校验 digest 和 byte length；
- 不提供绝对路径、任意文件系统句柄或可写对象；
- 下游 wave 只能读取前序 wave 已通过 Enrichment Admission 的对象与断言；
- 原始 staging、失败 Slice 和被拒绝 assertion 对下游不可见。

## 8. Staging Contract

### 8.1 Claim Basis

```ts
export type ClaimBasis =
  | { kind: "compiler_exact"; rule_id: string; rule_version: string }
  | {
      kind: "static_possible";
      rule_id: string;
      rule_version: string;
      approximation: "may";
      open_world_reason_codes: readonly string[];
    }
  | {
      kind: "framework_heuristic";
      profile_id: string;
      profile_version: string;
      rule_id: string;
    }
  | { kind: "runtime_observed"; execution_id: string; event_id: string }
  | { kind: "llm_inferred"; invocation_receipt_id: string };
```

静态 Semantic Enricher 只允许前三类。后两类由独立 Adapter/Module 使用共享 provenance vocabulary。

### 8.2 Subject 与规范值

```ts
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export type AnalysisRef =
  | { kind: "snapshot" }
  | { kind: "source_file"; file_path: string }
  | { kind: "definition"; definition_key: string }
  | { kind: "relation"; relation_key: string }
  | { kind: "semantic_object"; object_key: string }
  | { kind: "local_object"; ref: StagingRef };

export interface StagingRef {
  run_id: string;
  local_id: string;
}
```

`CanonicalValue` 禁止 `undefined`、非有限数字、循环对象、未规范键顺序和工具原生对象。

### 8.3 Object 与 Claim Draft

```ts
export interface SemanticObjectDraft {
  local_id: string;
  schema_id: string;
  value: CanonicalValue;
  parent?: AnalysisRef;
  evidence_refs: readonly StagingRef[];
}

export interface SemanticClaimDraft {
  local_id: string;
  schema_id: string;
  subject: AnalysisRef;
  value: CanonicalValue;
  basis: ClaimBasis;
  evidence_refs: readonly StagingRef[];
  input_claim_refs: readonly StagingRef[];
}
```

Adapter 只能分配当前 run 内的 `local_id`；跨 Slice 引用必须使用 `(run_id, local_id)` 组成的 `StagingRef`。Canonical object/fact key 由 Canonicalizer 根据 Snapshot、Schema、subject 和规范内容计算。

Semantic Enricher 不直接提交 `CanonicalRelation`。需要形成调用、控制流或数据流连接时，先提交注册 Schema 下的 Object/Claim Draft；是否物化为 Canonical Semantic Object、Fact 或 Edge 由对应 Schema policy 和 Canonicalizer 决定。

### 8.4 Evidence Draft

```ts
export type EnrichmentEvidenceDraft =
  | {
      local_id: string;
      kind: "source_span";
      file_path: string;
      span: ByteSpan;
      source_digest: string;
    }
  | {
      local_id: string;
      kind: "analysis_artifact";
      material_id: string;
      material_digest: string;
      selector?: string;
    }
  | {
      local_id: string;
      kind: "derivation";
      rule_id: string;
      rule_version: string;
      input_evidence_refs: readonly StagingRef[];
    }
  | {
      local_id: string;
      kind: "runtime_event";
      execution_id: string;
      trace_digest: string;
      event_id: string;
    }
  | {
      local_id: string;
      kind: "provider_receipt";
      invocation_receipt_id: string;
      request_bundle_digest: string;
      structured_output_digest: string;
    };
```

静态 Overlay 只接受前三类。每个 Object/Claim 至少引用一项 Evidence；全部引用必须形成 Evidence Closure。

### 8.5 Coverage 与 Slice

```ts
export interface CapabilityCoverage {
  capability: CapabilityRef;
  scope: { kind: "repository" } | { kind: "file"; file_path: string };
  status: "complete" | "partial" | "failed" | "skipped" | "unsupported";
  analyzed_count: number;
  omitted_count: number;
  reason_codes: readonly string[];
}

export interface EnrichmentCoverage {
  status: "complete" | "partial" | "failed" | "skipped";
  capabilities: readonly CapabilityCoverage[];
  truncated: boolean;
}

export interface EnrichmentSlice {
  run_id: string;
  repository_id: string;
  snapshot_id: string;
  adapter_id: string;
  adapter_version: string;
  objects: readonly SemanticObjectDraft[];
  claims: readonly SemanticClaimDraft[];
  evidence: readonly EnrichmentEvidenceDraft[];
  diagnostics: readonly Diagnostic[];
  coverage: EnrichmentCoverage;
  output_hash: string;
}

export interface EnricherRunReceipt {
  run_id: string;
  adapter_id: string;
  adapter_version: string;
  manifest_digest: string;
  input_hash: string;
  output_hash: string;
  status: "complete" | "partial" | "failed" | "skipped";
}

export interface EnrichmentStagingBatch {
  contract_version: string;
  base: ReadyStructuralSnapshotRef;
  enrichment_profile_digest: string;
  ordered_runs: readonly EnricherRunReceipt[];
  ordered_slices: readonly EnrichmentSlice[];
  diagnostics: readonly Diagnostic[];
  coverage: EnrichmentCoverage;
  batch_hash: string;
}
```

Coverage 规则：

- required binding 的承诺范围非 complete：不发布 Overlay；
- optional binding 可以 partial/failed/skipped，但必须保留原因；
- optional partial 中证据闭合的局部肯定 assertion 可以发布；
- 否定、全量集合、唯一性和“所有路径”等 Exhaustive Claim 必须绑定 complete Coverage；
- `status=complete` 的空结果与 `unsupported/skipped/failed` 完全不同；
- Coverage 不参与 Claim Basis 升级，只限制结论能否成立。

## 9. Fact Schema Registry

每个 Schema 必须是注册、版本化、可审计的领域契约：

```ts
export interface FactSchemaPolicy {
  schema_id: string;
  schema_digest: string;
  subject_kinds: readonly AnalysisRef["kind"][];
  cardinality: "single" | "set" | "multiset";
  allowed_basis_kinds: readonly ClaimBasis["kind"][];
  exact_eligible_basis_kinds: readonly ClaimBasis["kind"][];
  merge:
    | "same_value_union_evidence"
    | "set_union_preserve_origin"
    | "keep_distinct";
  exact_conflict: "fail_overlay" | "reject_claim";
  exhaustive: boolean;
}
```

V0 首批 namespace 由后续语义票补充，预计至少包括：

```text
scb.type.resolves-to@1
scb.call.site@1
scb.call.targets@1
scb.cfg.block@1
scb.cfg.edge@1
scb.data-flow.reaches@1
scb.effect@1
scb.framework.entrypoint@1
```

TypeScript declaration merging 只提供开发期类型。运行时仍必须通过版本化 Schema Registry 校验，不能相信编译时泛型或 Adapter 自报类型。

## 10. 调度与逐波准入

固定流程：

```text
解析并验证 Enrichment Profile
→ 验证 ReadyStructuralSnapshotRef
→ 建立 FrozenAnalysisView
→ 按 capability dependency 拓扑排序
→ 执行 wave N Adapter
→ 校验每份 EnrichmentSlice
→ Enrichment Admission
→ 构造只含 admitted 结果的下一波 FrozenAnalysisView
→ 汇总并规范化 EnrichmentStagingBatch
→ Semantic Overlay Canonicalizer 全局复核
→ Store 完整性检查
→ 原子发布 Overlay
```

V0 使用确定性的顺序 wave；同一 wave 可在结果排序与资源隔离可证明后并行。并发完成顺序不得影响输出。

内部 admission 不代表发布。最终 Canonicalizer 必须重新验证完整 batch 的 Profile、Schema、Evidence、Coverage、冲突和全局不变量。

## 11. Admission、合并与冲突

### 11.1 Admission 必查项

- repository/snapshot/graph/manifest/profile identity 一致；
- Adapter Manifest digest 与 Profile binding 一致；
- Schema 和 rule 已注册；
- subject 存在且属于当前 Snapshot 或当前 batch；
- Adapter 只使用 Profile 授权的 Schema 与 Claim Basis；
- Evidence Closure 完整，digest、span 和 material locator 合法；
- local ID 唯一且引用无环；
- value 可规范序列化；
- Coverage 与 assertion scope 一致；
- exact/Exhaustive Claim 满足额外 Coverage 要求；
- deterministic Adapter 的 output hash 可复算。

### 11.2 合并

- 相同 Snapshot、Schema、subject、规范 value 的 assertion 合并 Evidence 与 producer receipt；
- Canonical key 不含 Adapter ID，避免同一事实因不同生产者重复；
- set-valued `static_possible` 可以 union，但每个成员保留来源、规则和 Coverage；
- framework heuristic 可以去重，不改变 Claim Basis；
- Runtime Observation 仅在相同 Execution 与 event identity 下去重；
- LLM inference 只在同一 Invocation Receipt 内规范去重。

### 11.3 冲突

- `single` Schema 出现两个不同 `compiler_exact`：`semantic_fact_conflict`，required 能力下整个 Overlay 失败；
- exact 与 possible 冲突：exact 不降级，possible 保留并产生 `analysis_disagreement`；
- exact 与 heuristic 冲突：exact 保留，heuristic 标记 contradicted；
- Runtime Observation 与静态事实冲突：Observation 保留且标记冲突，不修改 Snapshot/Overlay；
- LLM inference 与任何已验证事实冲突：拒绝或标记 contradicted，不能改写事实；
- 禁止 Adapter priority、最后写入胜出和 confidence 选胜者。

## 12. 升级与拒绝

### 12.1 升级

Claim Basis 创建后不可改写。只有注册、版本化、确定性的独立分析规则可以产生新的 `compiler_exact` assertion。

- static possible：保留原 assertion；新编译器证明产生新 exact assertion；
- framework heuristic：V0 不升级；未来若引入公开且可重复的 framework-declared 类别，必须单独变更 Contract；
- runtime observed：无论观察多少次都不升级为静态 exact；
- llm inferred：永不升级；它只能建议执行新的本地受控查询；
- 人工确认 Capability Candidate 进入 Capability 生命周期，不转换为 compiler Fact。

### 12.2 硬拒绝

以下任一条件拒绝整份 Slice：

- Snapshot、Graph、Manifest 或 Profile identity 不匹配；
- 越权读取或 material digest 不匹配；
- 未注册 Schema/rule；
- Profile 未授权的 Schema、Claim Basis 或 capability；
- 跨 Snapshot 或 unresolved subject；
- Evidence 缺失、断链或 scope 不闭合；
- 输出工具原生对象或非规范 JSON；
- local ID、排序或 hash 含时间、PID、临时目录或并发完成顺序；
- Adapter 尝试写 Store、构造 Canonical ID 或发布结果；
- Runtime/LLM assertion 出现在静态 Overlay batch。

## 13. 错误语义

### 13.1 reject 的 Contract 错误

```text
INVALID_SNAPSHOT_VIEW
SNAPSHOT_NOT_READY
BASE_IDENTITY_MISMATCH
PROFILE_INVALID
DEPENDENCY_CYCLE
SOURCE_SCOPE_VIOLATION
SOURCE_DIGEST_MISMATCH
ADAPTER_PROTOCOL_ERROR
UNREGISTERED_SCHEMA
UNREGISTERED_RULE
AUTHORITY_VIOLATION
INVALID_EVIDENCE
CROSS_SNAPSHOT_REFERENCE
NONDETERMINISTIC_OUTPUT
SEMANTIC_FACT_CONFLICT
BASE_SUPERSEDED
PUBLISH_FAILED
```

Contract 错误使相关 Slice 作废；required Slice 作废则整个 Overlay 不发布。不得从非法 Slice 中挑选“看起来可用”的部分。

### 13.2 返回 Coverage/Diagnostic 的预期结果

```text
adapter_unavailable
adapter_failed
unsupported_language
unsupported_source
project_configuration_missing
analysis_budget_exhausted
analysis_timeout
dynamic_target_unresolved
optional_dependency_missing
external_invocation_not_authorized
```

这些结果必须稳定映射为 Diagnostic code 和 Coverage reason。系统不自动换 Adapter、不静默降级、不自动重试外部工具。

## 14. 确定性与重放

确定性静态 Adapter 在以下输入相同的情况下必须产生规范 JSON 等价的 Slice 和相同 `output_hash`：

- Ready Snapshot identity 与 material digests；
- Enrichment Profile；
- Adapter/engine/config 版本；
- Schema/Rule Registry 版本；
- budget；
- 已 admitted 的前序输入。

数组排序必须由 Schema policy 或规范 key 决定。时间戳、PID、绝对路径、临时目录、对象 identity、随机数和并发完成顺序不得进入 assertion identity。

Runtime 与 AI 的确定性边界：

- 导入同一个冻结 Trace artifact 必须得到相同 Observation Set；
- 导入同一个 AI Invocation Receipt 必须得到相同 inference artifact；
- 重新执行程序或重新调用 Codex 是新运行，不要求输出相同，必须创建新的 Execution/Receipt；
- 静态 Overlay 构建不得隐式触发 Trace 或 AI 调用。

## 15. 发布与查询边界

Semantic Overlay identity 至少绑定：

```text
repository_id
snapshot_id
structural_graph_hash
enrichment_profile_digest
schema_registry_digest
rule_registry_digest
canonical_semantic_content_hash
```

发布要求：

- 在隔离区构建；
- 完整 Canonicalization 与 Store integrity check 通过；
- 原子切换对应 Repository/Snapshot/Profile 的 Overlay pointer；
- 失败或中断不改变已有 pointer；
- 旧 Overlay 只能服务其原 Snapshot；
- 当前 Ready Snapshot 没有匹配 Overlay 时，查询返回明确 unavailable/unknown，不能套用旧结果；
- Runtime Observation Set 与 AI artifact 使用独立生命周期，不改变 Overlay Ready 状态。

SQLite 表、foreign key、migration、增量失效和清理策略由“定义语义数据存储、版本与增量发布策略”负责，本 Spec 不预先固定。

## 16. 依赖分类

| 依赖 | 类别 | 策略 |
|---|---|---|
| Schema/Rule Registry、DAG、merge、admission | In-process | 深化进 Module；通过公共 Interface 测试 |
| Frozen source/config reader | Local-substitutable | Manifest-scoped production Adapter + in-memory test Adapter |
| TypeScript Compiler、Pyright、CFG engine | Local-substitutable 第三方工具链 | 隐藏在内部 Adapter；真实锁版本 fixture 验证语义 |
| Framework Profile | In-process 版本化规则 | Profile/rule digest 进入 Overlay identity |
| SQLite Store | 当前唯一 Implementation | 不向 Enricher 暴露，不提前建立通用 Store port |
| 未来 owned analyzer daemon | Remote but owned | 有真实第二实现时再在内部 Seam 增加 port |
| Codex | True external | 独立 AI Provider port、逐次授权、mock Adapter；不进入静态 Enricher |

## 17. 安全与作用域

- Enricher 默认本地、只读、无网络；
- 目标 Repository 和源码不得被修改；
- 只允许读取 FrozenMaterialReader 中的 material；
- 本地编译器子进程必须声明版本、配置和输入范围；
- 临时物化目录在成功、失败、超时和取消后都要清理；
- Diagnostic 不保存凭据、绝对路径或无界工具输出；
- Trace 执行和 AI 调用需要各自显式 Grant，不继承静态 Enricher 权限；
- 源码、注释、配置、文档和工具输出均视为不可信数据，不能改变 Profile 或 Contract。

## 18. 验收标准

### 18.1 Contract Gate

- Manifest/Profile digest mismatch 被拒绝；
- 未注册 Schema/rule 被拒绝；
- 未授权 basis/schema 被拒绝；
- Adapter 只能返回 local ID；
- Runtime/LLM basis 不能进入静态 batch；
- 同一 Fact 的等价 Draft 合并 Evidence；
- single exact 冲突阻止发布；
- possible/heuristic 冲突不覆盖 exact；
- Evidence 断链、跨 Snapshot 和非法 span 被拒绝；
- required partial/failed/skipped 阻止发布；
- optional partial 保留局部肯定结果与 Coverage；
- Exhaustive Claim 在 Coverage 非 complete 时被拒绝。

### 18.2 Determinism Gate

- 相同冻结输入重复运行产生相同 Slice hash、batch hash 和 Overlay hash；
- Adapter 顺序、同 wave 并发顺序和临时目录变化不改变结果；
- 规范排序和 ID 不包含时间、PID 或绝对路径；
- 冻结 Trace/Receipt 重导入稳定，新执行/调用获得新 identity。

### 18.3 Publication Gate

- 成功 Overlay 精确绑定 base Snapshot；
- 构建失败、中断、超时或 pointer 前校验失败保留旧 pointer；
- 旧 Overlay 无法解析为新 Snapshot 的当前语义层；
- 当前 Snapshot 无匹配 Overlay 时查询显式返回 unavailable/unknown；
- Adapter 无法绕过 Canonicalizer 或直接访问 Store writer。

### 18.4 真实最小 Fixture

至少使用一组 TypeScript 和一组 Python fixture，证明：

- 一个 exact 类型/符号事实；
- 一个 static possible 调用目标集合；
- 一个 framework heuristic；
- 一个 Coverage 缺口；
- 一个 exact conflict；
- 一个 Evidence 回链；
- 增量与全量语义结果 parity。

具体 TypeScript/Python 工具和语义 Gold 由各自接入决策票冻结。

## 19. 后续票边界

本 Contract 只冻结公共 Interface、内部 Adapter Protocol 和权威规则。后续决策/实施不得重复发明这些边界：

| 后续票 | 使用本 Spec 的内容 | 该票负责新增的决策 |
|---|---|---|
| 选择 TypeScript 编译器语义接入方案 | Adapter、Manifest、Evidence、Coverage | Compiler API/ts-morph/SCIP、tsconfig、UTF-8 映射 |
| 选择 Python 语义接入方案与环境契约 | 同一 Adapter Contract | Pyright/SCIP、解释器与虚拟环境 |
| 定义 CallSite、CallTarget 与动态分派模型 | Object/Claim Schema、exact/possible | CallSite payload、target set 与动态边界 |
| 定义 V0 Control Flow 与 Behavior IR | Object/Claim Schema、DAG wave | Basic Block、边、异常与终止语义 |
| 定义 V0 Data Flow 与跨过程边界 | Evidence、Coverage、Exhaustive Claim | def-use、alias、跨过程预算 |
| 定义 Effect taxonomy 与外部库模型 | Schema Registry、framework heuristic | Effect taxonomy、Library Model |
| 确定 Entrypoint 与 Framework Profile | Profile/Rule digest、heuristic ledger | 入口类型和首批框架 |
| 定义 Runtime Observation 采集与关联契约 | runtime-observed 隔离规则 | Trace 格式、Execution 与 Snapshot 关联 |
| 定义语义数据存储、版本与增量发布策略 | Overlay identity、原子发布条件 | SQLite schema、migration、失效与清理 |
| 定义 Context Engine 与 Evidence Validator | Claim Basis、Evidence、Coverage | Query Plan、选取压缩、答案准入 |

最终 Wayfinder V0 Spec 再把这些实施边界转成可执行 DAG；当前不创建重复的实施票。

## 20. 固定结论

1. Semantic Enrichment Module 对外只有一个行为入口；
2. Semantic Overlay 与 Ready Structural Snapshot 分离且均不可变；
3. Profile 而非 Adapter Manifest 是信任根；
4. Claim Basis 不可原地修改；
5. Canonicalizer 独占正式语义准入；
6. required 能力不完整时失败关闭；
7. optional 局部结果不得支持否定或穷举结论；
8. Runtime Observation 与 LLM inference 永不成为静态权威事实；
9. 失败构建不得污染已有 Ready 结果；
10. 任何旧 Overlay 不得跨 Snapshot 复用。
