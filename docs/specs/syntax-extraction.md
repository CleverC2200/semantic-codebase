# Syntax Extraction Spec

状态：Accepted

版本：0.1

适用阶段：P1 Definition Registry → P2 Structural Code Graph

领域词汇：[CONTEXT.md](../../CONTEXT.md)

## 1. 目标

使用 Tree-sitter 作为 TypeScript 与 Python 的共同语法基线，把单个 `SourceFile` 转换为可重放、可追溯的语法事实与关系候选，并为后续仓库级 Resolver 提供稳定输入。

本 Spec 冻结以下方向：

1. Tree-sitter 只负责源码到 CST；CST 和 Tree-sitter 节点不进入 Canonical IR。
2. `Syntax Adapter` 通过窄 Interface 隐藏 grammar、Query、遍历和语言差异。
3. 逐文件阶段只发布确定性 Definition、文件内确定关系和 Relation Candidate。
4. 仓库级 Resolver 独立消歧；只有唯一解析且 Evidence 完整的候选才能成为 Relation。
5. CodeGraph 只作为工程参考与对照，不作为运行时依赖、Adapter 或事实来源。

成功意味着：同一份源码、相同 Adapter Profile 与配置重复执行时，产出相同的规范化 `SyntaxSlice`；每个已接受事实都能回到当前源码的 UTF-8 字节范围；不确定连接保持为 Candidate，而不是错误的权威 Relation。

## 2. 范围

### 2.1 首期支持

- 语言：TypeScript、Python。
- Definition：`module`、`class`、`interface`、`function`、`method` 中各语言适用的子集。
- 文件内确定关系：`CONTAINS`。
- Relation Candidate：`IMPORTS`、`EXPORTS`、`CALLS`、`INHERITS`、`IMPLEMENTS`、`REFERENCES` 中首期切片明确启用的种类。
- Evidence：源码摘要、Adapter 身份、配置摘要、UTF-8 半开字节范围。
- Diagnostic 与 Coverage：语法错误、跳过、未支持结构、资源限制和未解析候选。

### 2.2 非目标

- 编译器级类型检查、重载决议、动态分派、反射和运行时调用图。
- Tree-sitter CST/AST 的持久化或公共查询。
- CodeGraph Node/Edge schema 兼容。
- Rust Native Kernel、WASM/native 双实现和两条路径的 parity 维护。
- SCIP、LSP、框架路由、UI、MCP、daemon、watcher。
- 跨 Snapshot Definition Lineage。
- 依赖安装、构建目标仓库或任何联网分析。

## 3. 模块与 Seam

```text
SourceFile bytes
      │
      ▼
┌─────────────────────────────────────┐
│ Syntax Module                       │
│ Interface: extract(SourceFileInput) │
│                                     │
│ Tree-sitter runtime                 │
│   → language Query                  │
│   → small postprocessor             │
│   → normalization                   │
└─────────────────────────────────────┘
      │ SyntaxSlice
      ▼
┌─────────────────────────────────────┐
│ Resolver Module                     │
│ Candidate + frozen repository view │
│   → resolved / unresolved           │
└─────────────────────────────────────┘
      │ ResolutionSlice
      ▼
┌─────────────────────────────────────┐
│ Canonicalizer                       │
│ validate → key → merge → publish   │
└─────────────────────────────────────┘
      │
      ▼
Canonical IR / Ready Snapshot
```

### 3.1 Syntax Module

`Syntax Module` 是外部 Deep Module。调用者只学习一个 Interface；parser 生命周期、grammar 版本、Query 编译、CST 遍历、错误恢复和语言差异都属于 Implementation。

首期存在两个真实 Adapter：

- `TypeScriptTreeSitterAdapter`
- `PythonTreeSitterAdapter`

Adapter 由语言选择，但不向调用者暴露 Tree-sitter `Parser`、`Tree`、`Node`、Query capture 或 grammar node type。

### 3.2 Resolver Module

Resolver 只读取冻结的 Repository Manifest、所有文件的 `SyntaxSlice` 和已有确定事实。它负责模块路径、别名、限定名、容器和名称冲突消歧。

Resolver 必须返回“已唯一解析”和“仍未解析”两组结果。它不能使用浮点 confidence 把最佳猜测提升为 Relation。

### 3.3 Canonicalizer

Canonicalizer 是 Draft/Candidate 进入 Canonical IR 的唯一入口。它负责：

- 验证路径、范围、digest 和 Adapter Profile；
- 生成最终 Definition Key、Relation Key 和 Evidence ID；
- 合并等价事实；
- 隔离冲突；
- 稳定排序；
- 产出 Coverage 与 Diagnostics。

Syntax Adapter 和 Resolver 都不能直接写 Graph Store。

## 4. Syntax Adapter Interface

以下类型表达语义契约；具体 TypeScript 类型可在不改变语义的前提下收紧。

```ts
type Language = "typescript" | "python";

interface SourceFileInput {
  repository_id: string;
  snapshot_id: string;
  relative_path: string;
  language: Language;
  source_bytes: Uint8Array;
  source_digest: string;
}

interface SyntaxAdapter {
  readonly manifest: SyntaxAdapterManifest;
  extract(input: SourceFileInput): SyntaxSlice;
}

interface SyntaxAdapterManifest {
  id: string;
  version: string;
  language: Language;
  runtime: { id: string; version: string };
  grammar: { id: string; version: string; digest: string };
  query_digest: string;
  config_digest: string;
  capabilities: {
    definition_kinds: DefinitionKind[];
    exact_relation_kinds: RelationKind[];
    candidate_relation_kinds: RelationKind[];
  };
}

interface SyntaxSlice {
  file: {
    relative_path: string;
    language: Language;
    source_digest: string;
  };
  definitions: DefinitionDraft[];
  exact_relations: ExactRelationDraft[];
  relation_candidates: RelationCandidate[];
  evidence: EvidenceDraft[];
  diagnostics: Diagnostic[];
  coverage: FileCoverage;
}
```

### 4.1 Interface 不变量

1. `extract` 是只读纯转换：不联网、不安装依赖、不修改源码、不写 Store。
2. 输入 digest 必须与 `source_bytes` 一致；不一致返回失败 Diagnostic，不产生事实。
3. 所有范围使用 UTF-8 字节半开区间 `[start_byte, end_byte)`。
4. 所有本地 ID 只能由输入内容、位置、kind 和版本化配置派生；禁止使用 Tree-sitter node object identity、时间戳或遍历完成顺序。
5. 数组按规范顺序返回；相同输入必须产生字节等价的规范 JSON。
6. 每个 Definition、Exact Relation 和 Candidate 至少引用一份 Evidence。
7. Adapter 产出 file-local ID；最终 Canonical Key 由 Canonicalizer 生成。

## 5. Draft 与 Candidate

### 5.1 DefinitionDraft

```ts
interface DefinitionDraft {
  local_id: string;
  container_local_id: string | null;
  kind: "module" | "class" | "interface" | "function" | "method";
  language: Language;
  name: string;
  qualified_name: string;
  name_span: ByteSpan;
  definition_span: ByteSpan;
  content_hash: string;
  evidence_local_ids: string[];
}
```

Definition 必须具备可寻址名称。匿名函数、匿名 class expression 和无法稳定命名的 callable 不进入 V0.1 Definition；它们可以产生 Diagnostic，并把内部调用归属到最近的可寻址 Definition 或 SourceFile。

### 5.2 ExactRelationDraft

首期只有文件或 Definition 到 Definition 的 `CONTAINS` 可以在逐文件阶段成为确定关系。

```ts
interface ExactRelationDraft {
  local_id: string;
  kind: "CONTAINS";
  source_local_ref: SubjectLocalRef;
  target_local_id: string;
  evidence_local_ids: string[];
}

type SubjectLocalRef =
  | { kind: "source_file" }
  | { kind: "definition"; local_id: string };
```

Tree-sitter 父子关系不自动等于产品 `CONTAINS`。只有 Definition 的语义容器关系进入 Draft；语句、表达式和标点不进入 Structural Graph。

### 5.3 RelationCandidate

Candidate 描述“源码明确出现了一个连接意图，但目标尚未唯一绑定”。

```ts
interface RelationCandidate {
  local_id: string;
  kind: "IMPORTS" | "EXPORTS" | "CALLS" | "INHERITS" | "IMPLEMENTS" | "REFERENCES";
  source_local_ref: SubjectLocalRef;
  target_hint: TargetHint;
  evidence_local_ids: string[];
}

type TargetHint =
  | { kind: "name"; name: string; qualifier?: string }
  | { kind: "member"; receiver_text: string; member: string }
  | { kind: "module"; specifier: string; imported_name?: string; alias?: string };
```

`target_hint` 保存可审计的语法信息，不保存 Tree-sitter Node，也不保存未经证明的 target Definition Key。

### 5.4 EvidenceDraft

```ts
interface EvidenceDraft {
  local_id: string;
  file_path: string;
  span: ByteSpan;
  original_position_encoding: "utf8_bytes";
  source_digest: string;
  adapter_id: string;
  adapter_version: string;
  grammar_digest: string;
  query_digest: string;
  config_digest: string;
}
```

查询层需要行列号时，基于 Snapshot 中的原始字节计算；行列号不作为规范身份的一部分。

## 6. Tree-sitter Implementation

### 6.1 解析策略

首期使用 Node.js + TypeScript 和 native Tree-sitter binding。Parser runtime 位于 Syntax Module 内部；如果将来切换到 `web-tree-sitter`，调用者和 Canonical IR 不发生变化。

每个 SourceFile 执行：

```text
校验 bytes/digest/language
→ 选择已注册 Adapter
→ 解析完整文件 CST
→ 执行版本化 Query
→ 运行小型语言后处理器
→ 构建 Draft/Candidate/Evidence
→ 校验范围和引用
→ 规范排序
→ 返回 SyntaxSlice
```

首期持久索引以“变化文件完整重抽取”为增量单位。Tree-sitter 的 old-tree 编辑级增量仅在真实 daemon/editor 场景出现后评估；内存 Tree 和 Node 不跨进程、Snapshot 或 Adapter 版本复用。

### 6.2 Query 优先

每种语言使用版本化 `.scm` Query 捕获定义、名称、容器、import、call 和类型关系列表。Query capture 只属于 Adapter Implementation。

后处理器仅处理 Query 难以表达但仍属于确定语法的问题，例如：

- 构建 qualified name；
- 判断 Python class 直接子级函数为 method；
- 把具名变量绑定的 arrow/function expression 识别为 function；
- 读取 import alias、member receiver 和 heritage clause；
- 将捕获归属到最近的可寻址 Definition。

一个新规则优先进入对应语言 Query；只有需要上下文或规范化时才进入该语言后处理器。禁止建立跨语言的超大通用 walker。

### 6.3 Grammar 与 Query 版本

- runtime、grammar、Query 和后处理规则都进入 `SyntaxAdapterManifest`。
- grammar 或 Query 改变时必须改变对应 digest。
- Adapter Profile digest 是 Snapshot 身份的一部分。
- 启动时编译并验证所有 Query；任一必需 Query 与 grammar 不兼容时，该 Adapter 不可用，Snapshot 构建失败。

### 6.4 语法错误

Tree-sitter 的 `ERROR` 或 `MISSING` 节点必须形成 Diagnostic，并使对应文件 Coverage 至少为 `partial`。

语法错误不自动丢弃整个文件：

- 如果 Definition 的 kind、name 和范围仍能唯一确定，可以保留 Definition；
- 如果 name 落在错误节点中、边界不确定或多个解释竞争，排除该 Draft，并产生 Diagnostic；
- 函数体中的错误不应自动否定已明确的函数声明；
- 任何受错误影响的 Relation Candidate 保持未解析状态。

## 7. 语言能力

### 7.1 TypeScript

首期 Definition：

- `namespace` / `module` 声明 → `module`
- class declaration → `class`
- interface declaration → `interface`
- named function declaration → `function`
- method/getter/setter → `method`
- 绑定到稳定标识符的 arrow function / function expression → `function`
- class field 直接绑定 callable → `method`

首期 Candidate：

- import/export 声明；
- bare、qualified 和 member call；
- class/interface heritage 中的 extends/implements；
- 显式类型/标识符引用只在对应切片启用后抽取。

### 7.2 Python

首期 Definition：

- class definition → `class`
- module/class/nested scope 中的 named function definition → `function` 或 `method`
- class 的直接成员函数，包括 decorated、async 和 class/static method → `method`

首期 Candidate：

- `import` 与 `from ... import ...`；
- bare、qualified 和 attribute call；
- class base list → `INHERITS` Candidate；
- 显式名称引用只在对应切片启用后抽取。

Python 源文件本身是 SourceFile，不自动创建 `module` Definition；只有显式可寻址声明进入 Definition Registry。

## 8. Resolution 与事实提升

Resolver 按以下顺序尝试候选：

1. 同文件 local ID 或 qualified name 精确匹配；
2. 显式 import/export mapping；
3. Repository Manifest 中规范化模块路径；
4. 容器、语言和限定名联合匹配；
5. 仍有多个或零个目标时保持 unresolved。

完成条件是目标唯一且每一步均可回放。目录距离、名称相似度和“选择最佳候选”不能单独完成事实提升。

每次 Resolution 输出：

```ts
interface ResolutionSlice {
  resolved_relations: ResolvedRelationDraft[];
  unresolved_candidates: RelationCandidate[];
  diagnostics: Diagnostic[];
  coverage: ResolutionCoverage;
}
```

Canonicalizer 只有在以下条件全部满足时才发布 Relation：

- source 和 target 都属于同一 Snapshot；
- 两端唯一存在；
- relation kind 与 Adapter Profile 能力一致；
- Evidence 的 source digest 与 Snapshot SourceFile 一致；
- 不存在不可调和冲突。

## 9. Coverage 与 Diagnostic

文件 Coverage 至少包含：

```ts
interface FileCoverage {
  status: "complete" | "partial" | "failed" | "skipped";
  definitions: "complete" | "partial" | "unsupported";
  relation_candidates: "complete" | "partial" | "unsupported";
  error_count: number;
  unresolved_candidate_count: number;
}
```

Diagnostic 必须具有稳定 code、severity、file path、可选 byte span 和简短 message。首期至少定义：

- `source_digest_mismatch`
- `unsupported_language`
- `adapter_unavailable`
- `query_incompatible`
- `syntax_error`
- `missing_syntax`
- `ambiguous_definition`
- `unsupported_anonymous_definition`
- `invalid_utf8_range`
- `resource_limit_exceeded`
- `unresolved_relation_candidate`

“未发现结果”只有在 Coverage 对该能力为 `complete` 时才能解释为受支持范围内不存在；否则查询必须同时返回 Coverage 或 Diagnostic。

## 10. 确定性与安全

### 10.1 规范排序

输出按以下键排序：

- Definition：`definition_span.start_byte, kind, qualified_name, local_id`
- Exact Relation：`kind, canonical(source_local_ref), target_local_id, local_id`
- Candidate：`evidence.start_byte, kind, source_local_ref, local_id`
- Evidence：`span.start_byte, span.end_byte, local_id`
- Diagnostic：`span.start_byte?, code, message`

hash 输入使用规范 JSON；对象键顺序、空值表示和 Unicode 规范化规则由 Contract Module 统一实现。

### 10.2 只读与隔离

- 只读取调用方提供的 `source_bytes`；Adapter 不自行跟随路径读取其他文件。
- 不执行目标仓库代码，不加载其依赖，不运行 package scripts。
- 不联网，不把源码、日志、路径、Evidence 或摘要发送到外部服务。
- 临时缓存只能包含任务拥有、可再生的数据，并以 source/config digest 隔离。
- 日志不得输出源码正文；Diagnostic 只包含必要的位置和结构名称。

## 11. 建议目录

```text
src/
├── contract/
│   └── syntax.ts
├── syntax/
│   ├── index.ts
│   └── tree-sitter/
│       ├── runtime.ts
│       ├── normalize.ts
│       ├── typescript/
│       │   ├── definitions.scm
│       │   ├── relations.scm
│       │   └── postprocess.ts
│       └── python/
│           ├── definitions.scm
│           ├── relations.scm
│           └── postprocess.ts
├── resolution/
└── canonicalization/

test/
├── fixtures/syntax/typescript/
├── fixtures/syntax/python/
├── syntax/
└── contract/
```

这是导航结构，不要求预先创建空目录。每个切片只创建当前需要的 Module。

## 12. 实施切片

### S1：Definition 与 Evidence

实现：

- Contract 中的 `SourceFileInput`、`SyntaxAdapterManifest` 和 `SyntaxSlice`；
- TypeScript/Python Adapter；
- definitions Query 与最小后处理器；
- Definition、CONTAINS、Evidence、Coverage、Diagnostic；
- 规范 JSON 和 golden fixture。

完成标准：

1. 两种语言均覆盖顶层和嵌套 Definition、qualified name、容器和精确范围。
2. 中文标识符或字符串、emoji、CRLF、注释和字符串中的伪代码不造成范围漂移或误捕获。
3. 每个 Definition 的 `name_span`、`definition_span` 都能从原始 bytes 切片复核。
4. 同一 fixture 连续三次得到相同规范 JSON 和 hash。
5. 语法错误 fixture 保留不受影响的 Definition，并返回 `partial` Coverage。

### S2：Relation Candidate

实现：

- imports/exports/calls/heritage Query；
- `TargetHint` 规范化；
- Candidate Evidence 与 unresolved Diagnostic。

完成标准：

1. TypeScript/Python 的 alias import、member call、bare call 和继承场景均有 fixture。
2. Candidate 只描述源码出现的连接意图，不包含猜测的 Definition Key。
3. 注释、字符串、类型文本和语法恢复节点不产生额外错误 Candidate。
4. Candidate 数量、顺序和 Evidence 在重复执行中稳定。

### S3：确定性 Resolver

实现：

- 冻结 Repository Manifest；
- 同文件、import mapping、模块路径和 qualified name 解析；
- resolved/unresolved 分流；
- Canonicalizer 事实提升。

完成标准：

1. 唯一目标成为 Relation；零目标和多目标保持 Candidate。
2. fixture 覆盖同名冲突、alias、循环 import、删除文件和路径变化。
3. 不产生已知错误 Relation；宁可漏连，不可错连。
4. 增量重抽取后的规范图与全量重建语义等价。

### S4：性能优化

只有 S1～S3 正确性门槛通过且真实 Corpus 指标显示瓶颈后进入：

- 文件级 worker pool；
- Query 缓存与 parser 复用；
- 内容 digest 缓存；
- edit-level old-tree 增量；
- native/WASM runtime 对照。

任何优化必须通过与基线的规范输出 parity；性能提升不能改变事实、排序、Coverage 或 Diagnostic。

## 13. 测试矩阵

每种语言至少覆盖：

- 顶层、嵌套和同名 Definition；
- callable binding、method、decorator/modifier；
- import alias、相对路径、bare/member call；
- inheritance/implements 的适用语法；
- 注释和字符串中的伪声明；
- 空文件、仅注释文件、部分语法错误；
- UTF-8 多字节字符、emoji、LF/CRLF；
- 大量重复同名候选；
- grammar/Query 不兼容；
- digest 不匹配和资源限制。

测试只通过公共 `SyntaxAdapter` Interface 断言规范结果。内部 Query 或 CST snapshot 可以辅助诊断，但不能替代 Interface 测试。

CodeGraph 可以在冻结公开 Corpus 上作为黑盒对照，比较 Definition/Candidate 覆盖和索引成本；其输出不能作为 Gold，也不能绕过本 Spec 的 Evidence 与事实提升规则。

## 14. 已拒绝或延后方案

| 方案 | 决定 | 原因 |
| --- | --- | --- |
| 直接采用 CodeGraph | 拒绝 | 图模型、Resolver 和产品生命周期不属于本项目的 Canonical IR。 |
| 单个跨语言大型 walker | 拒绝 | Interface 和 Implementation 逐步变浅，语言变更缺乏 Locality。 |
| 只使用 `.scm` Query | 拒绝 | qualified name、容器和 callable binding 仍需要少量上下文处理。 |
| Query + 小型语言后处理器 | 接受 | 保持规则可读、语言知识局部化，同时隐藏 CST 细节。 |
| 启发式最佳匹配写 Relation | 拒绝 | 低置信边会污染权威 Structural Graph。 |
| 逐字符持久增量 | 延后 | 文件完整重抽取更容易证明与全量结果等价。 |
| Rust Kernel / 双实现 | 延后 | 正确性和真实性能证据尚不足以支付 parity 成本。 |
| SCIP TypeScript | 延后到实验 Profile | 可补充编译器语义，但不能成为 `core` 正确性的前提。 |

## 15. Spec 完成标准

本 Spec 对应的能力在以下条件全部满足时完成：

1. S1～S3 的完成标准全部通过。
2. TypeScript/Python fixture 的受支持期望事实 100% 命中，且不存在额外错误权威事实。
3. 每个 Definition 和 Relation 都可通过 Evidence 回链到 Snapshot 源码。
4. 同一输入重复构建结果确定，增量结果与全量重建语义等价。
5. 所有 unresolved、partial、failed 和 skipped 状态对调用者可见。
6. 运行保持本地、只读、断网，不读取仓库范围外源码，也不执行目标代码。

## 16. 参考边界

- [早期 Slice 1 验收收据](../../.scratch/semantic-codebase/receipts/slice-1-acceptance.md)：保留 Definition/Evidence/Snapshot 原型的历史行为证据；原型源码已从当前工作区退役。
- 本地 `references/zod/`：固定提交的 TypeScript 真实项目测试语料，不是运行时依赖；当前先用 `packages/zod/src/v3/` 做快速 smoke，完整范围保留为 grammar 兼容门禁；该目录不进入 Git。
- 本地 `references/codegraph/`：Tree-sitter、多语言抽取、Resolver、worker 和 SQLite 工程参考，不作为运行时依赖；该目录不进入 Git。
- [历史 Syntax Adapter 决策](../../.scratch/semantic-codebase/issues/09-decide-source-adapter-seam.md)：本 Spec 的上游决策证据；当前执行以本 Spec 和 `CONTEXT.md` 为准。
