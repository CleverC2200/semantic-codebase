# P0～P2 开源借鉴地图

> 目的：为 Semantic Codebase V0.1 选择能最快形成原型的外部能力来源。V0.1 的实现、Canonical IR、Evidence Model、Snapshot 生命周期与 CLI/MCP 契约均归自有代码；此表不构成许可证意见。
>
> 核验时间：2026-08-17。只使用官方仓库、官方文档和当前归档于 `references/codegraph` 的本地源码。链接中的能力是“可借鉴的已核验事实”，不是对性能、覆盖率或安全性的背书。

## 采用总览

| 阶段 | 原型目标 | 优先借鉴 | 明确不做 |
| --- | --- | --- | --- |
| P0 Benchmark | 用冻结公开样本验证工具是否提高 Agent 的结构化检索能力，而不是复述供应商数字。 | CodeGraph 的“有图/无图”对照思路与 CLI/MCP 可测表面；Codebase-Memory 仅作待核验的市场候选。 | 不复制任何项目的题目、Gold、成本结论或安装器；不将私有代码发给托管模型。 |
| P1 Definition Registry | 在 TypeScript/Python 中确定声明、源码位置、文件内容指纹和证据；可选提升为编译器级符号。 | **Tree-sitter 直接复用**；SCIP / scip-typescript 通过 Adapter；Kythe 与 Unison 只借身份和证据分离思想。 | 不将 AST 节点、SCIP symbol 或内容哈希直接宣称为跨 Snapshot 的永久 Definition 身份。 |
| P2 Structural Code Graph | 基于 P1 的已确认实体写入本地 Snapshot 图，支持有界邻居、路径和影响查询。 | CodeGraph 的本地抽取→解析→落库节奏；Infigraph 的 Store Backend、文件 hash 与重解析责任边界；Kythe 的 Fact/关系/Anchor 分离。 | 不引入 Cypher、Neo4j、向量、聚类、污点、远程服务或通用 MCP 工具集。 |

原型实施顺序固定为：**Tree-sitter P1 core → SQLite P2 core → CLI/MCP → scip-typescript enrichment → P0 smoke**。这样 P0 测量的是自有核心，而不是某个外部工具是否能运行。

## P0：Benchmark

| 项目 | 官方链接与已核验能力 | 采用方式 | 采用内容 | 不照搬 | 原型优先级 |
| --- | --- | --- | --- | --- | --- |
| CodeGraph（当前本地副本对应 `colbymchenry/codegraph`） | [官方仓库](https://github.com/colbymchenry/codegraph)、[工作方式](https://colbymchenry.github.io/codegraph/core-concepts/how-it-works/)。本地源码显示其以 Tree-sitter 抽取、SQLite `nodes/edges/files/unresolved_refs`、后续引用解析和 MCP 查询组成管线；`README` 也公开描述有索引/无索引的 Agent 对照。 | **借思想**；可作为独立参考组，绝不成为发布裁判或运行时依赖。 | 同题、同仓库提交、同模型设置下比较 Baseline 与自有 CLI/MCP；记录每 run 的答案、工具调用、源码读取、Token 和失败原因。 | README 的题目、样本、Gold、百分比、提示词、工具列表和“必然节省”的结论；不把其 Node/Edge schema 当 IR。 | **P0-1**（先设计 harness；正式 smoke 待 P1/P2 可用）。 |
| Codebase-Memory | 用户给出的名称不是唯一项目名；名称检索最匹配的是 [DeusData/codebase-memory-mcp 官方仓库](https://github.com/DeusData/codebase-memory-mcp)。其 README 宣称 Tree-sitter 图索引、可选 Hybrid LSP、MCP 与本地二进制，但这不足以确认“Codebase-Memory”是否就是用户意指的唯一/长期维护项目。 | **暂不采用（身份降级）**。 | 只保留“持久索引需要显式单写入、项目锁、CLI 与 MCP 生命周期分离”的待复核观察，后续有明确项目身份且 P2 瓶颈出现时再评审。 | 不运行其安装器、不接入 daemon、不采纳其 benchmark 声明、MCP 工具面、agent 配置写入或安全结论。 | **P0-0**（不阻塞原型）。 |

P0 的自有验收以本地 deterministic fixture 和小型公开 Corpus 的双轨为准。外部工具的数字只能是背景材料；每一条可比较结论都必须由本项目冻结的输入、运行配置和原始收据重算。

## P1：Definition Registry

| 项目 | 官方链接与已核验能力 | 采用方式 | 采用内容 | 不照搬 | 原型优先级 |
| --- | --- | --- | --- | --- | --- |
| Tree-sitter | [官方仓库](https://github.com/tree-sitter/tree-sitter)、[官方文档](https://tree-sitter.github.io/tree-sitter/)、[TypeScript grammar](https://github.com/tree-sitter/tree-sitter-typescript)、[Python grammar](https://github.com/tree-sitter/tree-sitter-python)。官方说明它是 parser generator 与增量解析库，可构建并高效更新 concrete syntax tree。 | **直接复用**（固定版本的 runtime 与 TS/Python grammar）。 | 逐文件产生 module/class/interface/function/method 候选、嵌套关系、import/call 的语法证据和 byte span；以 `path + content digest + grammar/adapter version` 重抽取变更文件。 | 不把 CST 当跨文件绑定或类型事实；不复制 CodeGraph 的语言枚举、启发式或 extractor 表；不把编辑器内存增量树当持久索引 delta 协议。 | **P1-0**（core 的首个实现切片）。 |
| SCIP | [官方仓库与协议](https://github.com/scip-code/scip)、[SCIP proto](https://github.com/scip-code/scip/blob/main/scip.proto)、[格式文档](https://github.com/scip-code/scip/blob/main/docs/scip.md)。协议定义一个 workspace 的完整 `Index`，其中 `Document` 有 occurrence、defined symbols、position encoding，且可流式读取。 | **Adapter**（可选 semantic enricher）。 | 将一次 `index.scip` 导入候选 Snapshot：保留 tool/version/config/source digest，转换已验证的 definition/reference/relationship 为自有实体、Relation 与 Evidence；外部 symbol 不等同本地 Definition。 | 不公开 protobuf、symbol 字符串、`Document.text` 或协议字段为产品 API；不把完整 Index 当增量、commit 或 Snapshot 生命周期语义。 | **P1-2**（core 成功后）。 |
| scip-typescript | [官方仓库](https://github.com/sourcegraph/scip-typescript)。README 明确它是 TS/JS SCIP indexer；TypeScript 项目从含 `tsconfig.json` 的根运行，JavaScript 可使用 `--infer-tsconfig`。 | **Adapter**（首个实验 enrichment）。 | 受控子进程产出 `index.scip`，以 `tsconfig`、indexer/TypeScript 版本和工作树 digest 绑定；仅在输入仍匹配时合并到 Snapshot，并把跳过/失败作为 Coverage。 | 不把它作为 P1 core 的前置条件；不静默生成/修改用户的 tsconfig、依赖或项目环境；不以其输出覆盖冲突的基础语法 Evidence。 | **P1-3**。 |
| Kythe | [官方仓库](https://github.com/kythe/kythe)、[Storage Model](https://kythe.io/docs/kythe-storage.html)、[Schema Overview](https://kythe.io/docs/schema-overview.html)。其模型将 VName、原子 Fact、有向 Edge 区分开；Anchor 表示文件范围，语义节点可经 Anchor 获得位置。 | **借思想**。 | Definition/Relation 与 Source Evidence 分离；Fact 有 namespace、受控 key 和来源；范围统一为半开区间，保留原始位置编码。 | 不采用 VName/ticket、任意 bytes Fact bag、Kythe edge 名称、Entry 排序或其全量 schema；不把每次源码出现都升格为 Definition。 | **P1-1**（指导自有 IR，不新增依赖）。 |
| Unison | [官方仓库](https://github.com/unisonweb/unison)、[官方“content-addressed code”说明](https://www.unison-lang.org/learn/the-big-idea/)。它以实现内容 hash 标识函数、将代码 AST 存入数据库，并将人类名称与 hash 的关联分离。它是编程语言及其 codebase manager，不是 TS/Python 静态索引器。 | **借思想**。 | “显示名/路径/位置不等于身份”和“不可变内容可缓存”的边界，帮助设计 Definition Key、content digest 与 Snapshot 的职责分离。 | 不采用 Unison hash 作为源码声明的永久 ID，不接入其数据库/语言服务器/MCP；不承诺 rename/move 具有跨 Snapshot 连续性。 | **P1-4**（设计校验，无实现依赖）。 |
| CodeGraph（当前本地源码） | [官方仓库](https://github.com/colbymchenry/codegraph)。本地 `references/codegraph/src/extraction/languages/typescript.ts` 与 `python.ts` 证明其以 Tree-sitter 节点种类、范围和语言规则抽取；`src/resolution/` 另行做引用解析。 | **借思想**。 | 采用“语法抽取和跨文件解析分阶段”、按文件内容 hash 替换派生产物、未解析项显式保留等待解析的实现节奏。 | 不拷贝其 NodeKind/EdgeKind、限定名 hash、framework synthesizer、名称匹配 heuristics 或 SQLite 细节；它们不成为 V0.1 定义注册表协议。 | **P1-1**（实现参考）。 |

P1 的硬边界：只有可确认的声明才写入 Definition Registry；动态调用、同名冲突、缺少环境和无法唯一绑定的引用产出 `RelationCandidate + Diagnostic/Coverage`，不能伪造成确定 Relation。

## P2：Structural Code Graph

| 项目 | 官方链接与已核验能力 | 采用方式 | 采用内容 | 不照搬 | 原型优先级 |
| --- | --- | --- | --- | --- | --- |
| CodeGraph（当前本地源码） | [官方仓库](https://github.com/colbymchenry/codegraph)。本地 [schema.sql](../../../references/codegraph/src/db/schema.sql) 具备 `nodes`、`edges`、`files`、`unresolved_refs`、FTS5、内容 hash 和双向 edge 索引；`src/resolution/` 证明关系解析与抽取可解耦。 | **借思想**。 | 本地 SQLite、按文件内容 hash 的增量、抽取后解析、显式 provenance、source/target 双向邻接索引和有界查询的工程拆分。 | 不复用其物理 schema、FTS trigger、Node/Edge 枚举、单库 mutable 语义、MCP 输出或功能数量；V0.1 以不可变 Snapshot 为查询边界。 | **P2-0**（SQLite core）。 |
| Infigraph | [官方仓库](https://github.com/intuit/infigraph)、[GraphBackend](https://github.com/intuit/infigraph/blob/main/crates/infigraph-core/src/graph/backend.rs)、[schema](https://github.com/intuit/infigraph/blob/main/crates/infigraph-core/src/graph/schema.rs)。官方源码定义 `GraphBackend`，含 `get_file_hashes`、`upsert_file`、`re_resolve_for_files`；实现同时面向嵌入式 Kùzu 与 Neo4j，并拥有远超 V0.1 的 Symbol/Cluster/TAINT_FLOW 等表。 | **借思想**。 | `GraphStore` 隔离具体后端；由 Store 原子拥有文件 hash、文件替换与受影响关系重解析；为未来后端替换保留窄接口。 | 不引入 Kùzu/Neo4j、Cypher、远程多仓库、向量/embedding、Cluster/Concern、taint、document/wiki 抓取、watcher 或其 MCP/UI。 | **P2-1**（接口设计参考）。 |
| Kythe | [Storage Model](https://kythe.io/docs/kythe-storage.html)、[Schema Overview](https://kythe.io/docs/schema-overview.html)。Fact、Edge 和 Anchor 的分层说明，位置证据和语义实体无需互相伪装。 | **借思想**。 | Relation 与其 Evidence 一对多关联；受控 Fact namespace；查询返回关系路径时携带可定位的 Evidence。 | 不将 GraphStore 建成 Kythe Entry/VName 兼容层，也不开放可随意扩展的边/Fact 语义。 | **P2-1**（IR 与 Evidence 校验）。 |
| SCIP / scip-typescript | [SCIP](https://github.com/scip-code/scip)、[scip-typescript](https://github.com/sourcegraph/scip-typescript)。SCIP `SymbolInformation.relationships` 与 Occurrence 可提供来自编译器/分析器的关联及其位置。 | **Adapter**（仅承接 P1 enrichment 的已验证结果）。 | 把已通过 Snapshot/输入校验的 `REFERENCES`、`IMPLEMENTS` 等结果转为 P2 Relation，并同时保存原始 symbol、position encoding 和 Adapter Run Evidence。 | 不让 SCIP 跨过 P1 直接写数据库；不因 protocol 中有 relationship 就承诺所有静态/动态调用都已解析。 | **P2-2**。 |
| Tree-sitter | [官方文档](https://tree-sitter.github.io/tree-sitter/)。CST 是语法与位置来源。 | **直接复用**（延续 P1 的依赖）。 | 为 `CONTAINS`、`IMPORTS`、候选 `CALLS` 提供可重放语法证据；以 source digest 防止旧树混入新 Snapshot。 | 不把 Tree-sitter 的节点父子关系原样暴露成全部产品图边，也不以 CST 推断类型、继承或跨文件目标。 | **P2-0**。 |
| Unison | [官方仓库](https://github.com/unisonweb/unison)、[官方说明](https://www.unison-lang.org/learn/the-big-idea/)。内容寻址与名称映射分离是它自身代码库的核心模型。 | **借思想**。 | 不可变查询对象和缓存 key 必须绑定内容/配置；名称与现实位置可变，不能破坏已发布 Snapshot。 | 不改用全局 content-addressed graph，也不实现其 codebase/refactoring 模型。 | **P2-3**（未来 Snapshot/缓存复盘）。 |
| Codebase-Memory | [DeusData/codebase-memory-mcp 官方仓库](https://github.com/DeusData/codebase-memory-mcp)。README 包含本地知识图、MCP、daemon、watcher 和多类索引主张，但“Codebase-Memory”指代仍不唯一，且能力表面显著超出 V0.1。 | **暂不采用（身份与范围降级）**。 | 仅将“多前端共享状态必须有单 writer 和显式生命周期”记录为以后审查题目；无实现承诺。 | 不安装 binary、不接管用户的 agent config、不引入 daemon、自动 watcher、UI、Cypher、LSP bridge 或 benchmark 数据。 | **P2-0**（不进入依赖图）。 |

## 可执行的最小借鉴清单

1. **P1-0**：锁定 Tree-sitter runtime 与 TypeScript/Python grammar 版本；实现逐文件 Definition/Evidence 抽取，不做跨文件“猜测连接”。
2. **P2-0**：实现自有 SQLite `GraphStore`：不可变 Snapshot、单 writer、文件 digest、Definition/Relation/Fact/Evidence、双向有界邻接。
3. **P1/P2-1**：按照 CodeGraph 的“两阶段”与 Kythe 的“语义/位置分离”补齐 resolver、Coverage 与未解析诊断；不复制其 schema。
4. **P1/P2-2**：以 `scip-typescript` 跑出第一个受控的实验 Adapter；失败只降低 Coverage，不阻塞 `core` Profile。
5. **P0-1**：在公开冻结 Corpus 上执行自有 Baseline/V0.1 16 题 × 2 次 Smoke；CodeGraph 可另列为参考组，但不决定通过与否。

## 延后与再评审条件

- 当 SQLite 的有界邻接和 P0 结果证明不足以满足规模/查询需求时，才用 Infigraph 的 Backend 边界评审可替换后端；不是现在引入图数据库的理由。
- 当需要严谨的跨 Snapshot rename/move/merge 连续性时，才重新审视 Unison 的内容寻址思路；当前 Definition Key 仍只在 Snapshot 内有效。
- 当用户明确确认要研究的 `Codebase-Memory` 的仓库、维护者与目标能力，且其能力无法由现有 core/Adapter 覆盖时，才进行独立的许可证、运行隔离、真实性与可维护性审查。
