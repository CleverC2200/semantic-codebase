# Semantic Codebase P0～P7 开源项目能力地图

> 目的：按“比读文件更快 → 理解影响范围 → 理解程序行为 → 理解软件知识 → 理解业务能力 → 按受众编译认知”的路线，明确每个阶段借鉴哪些开源项目、借什么、如何采用。
>
> 核验日期：2026-08-17。依据项目官方仓库、官方文档和本地已拉取的 CodeGraph 源码；这是一份实施参考，不是许可证法律意见，也不表示立即安装所有项目。

## 采用标记

- **直接复用**：作为固定版本的构建期或运行期依赖，复用成熟能力。
- **Adapter 接入**：外部工具独立运行，只把带版本、配置、输入摘要和 Evidence 的结果转换进自有模型。
- **借鉴设计**：学习数据模型、算法或交互，但不复制其协议和实现。
- **暂不采用**：身份、许可证、副作用、维护性或阶段价值不清楚，不进入依赖图。

核心原则：Semantic Model、Evidence Model、Snapshot、Capability Model 和 Cognitive Compiler 始终自有；外部项目只能处于解析依赖、Adapter、候选生成、对照评测或展示层。

## 阶段总览

| 阶段 | 要解决的问题 | 主要参考项目 | 默认采用方式 | 本阶段交付 |
| --- | --- | --- | --- | --- |
| P0 Benchmark | 是否真的比直接读文件更快、更准、更省上下文 | CodeGraph；Codebase Memory（待核验候选） | CodeGraph 借鉴设计/独立对照；Codebase Memory 暂不采用 | 冻结语料、Baseline/V0.1 同题评测、原始运行收据 |
| P1 Definition Registry | 代码里有哪些可定位、可重建的定义 | Tree-sitter；SCIP/scip-typescript；Kythe；Unison；CodeGraph | Tree-sitter 直接复用；SCIP Adapter；其余借鉴设计 | TS/Python Definition、位置、内容摘要、Evidence、Coverage |
| P2 Structural Code Graph | 定义如何包含、导入、引用、调用和继承 | CodeGraph；Infigraph；Kythe；SCIP；Tree-sitter | Tree-sitter 直接复用；SCIP Adapter；其余借鉴设计 | 本地不可变 Snapshot、SQLite GraphStore、六类有界查询 |
| P3 Context Engine | 针对任务和 Token 预算，应给 Agent 哪些上下文 | Aider repo-map；RepoGraph；LocAgent；CodeGraph；Codebase Memory；GitNexus | 以 Aider 为主要设计参考；其他只作设计/隔离对照 | 可复现、可解释、可截断的 ContextPackage |
| P4 Behavior Graph | 值和控制如何在程序中传播 | Joern/CPG；CodeQL；Semgrep | Joern 与 CodeQL 做按需 Adapter spike；Semgrep 作 Finding Adapter | CFG/数据流/污点路径/规则 Finding，和 P2 图严格分层 |
| P5 Software Knowledge Graph | 如何把代码、配置、文档、运行观测统一为有来源的软件知识 | PROV-O；Graphify；OpenTelemetry | PROV-O 借鉴设计；Graphify/OTel 受限 Adapter | Fact、Evidence、AdapterRun、来源和确定性分层 |
| P6 Capability Graph | 哪些组件共同实现了什么业务/产品能力 | Backstage Catalog；Graphify；GitNexus | Backstage Adapter + 设计参考；Graphify 仅生成候选；GitNexus 暂不接入 | 可解释的 Capability Candidate 与人工接受/修改/拒绝流程 |
| P7 Cognitive Compiler | 如何按不同受众和任务生成可理解的地图 | Archify；Structurizr；Understand Anything | Archify 直接复用为展示器；其余借鉴设计 | Evidence-linked Projection/Story、架构图和自包含 HTML |

## P0：Benchmark

### 主要借鉴

- [CodeGraph](https://github.com/colbymchenry/codegraph)：借鉴“无图 Baseline / 有图工具”同题对照、CLI/MCP 可测表面和失败原因记录。它可以作为公开语料上的独立参考组，但不作为 Gold，也不复用其题目、百分比或结论。
- [Codebase Memory MCP](https://github.com/DeusData/codebase-memory-mcp)：名称并不唯一，且安装会涉及本地二进制、后台生命周期和 Agent 配置。当前只保留为市场观察项，不安装、不采用其 benchmark 声明。

### 决策

P0 测量的是自有 P1/P2 核心是否产生价值，而不是某个外部项目能否跑起来。固定公开仓库提交、题目、Agent profile、提示、工具表和逐次运行收据；私有源码不进入托管模型评测。

## P1：Definition Registry

### 主要借鉴

- [Tree-sitter](https://github.com/tree-sitter/tree-sitter)、[TypeScript grammar](https://github.com/tree-sitter/tree-sitter-typescript)、[Python grammar](https://github.com/tree-sitter/tree-sitter-python)：**直接复用**固定版本，负责逐文件语法树、声明候选、位置和增量重解析。
- [SCIP](https://github.com/scip-code/scip) + [scip-typescript](https://github.com/sourcegraph/scip-typescript)：作为可选 **Semantic Enricher Adapter**，补充编译器级 definition/reference/relationship；外部 symbol 不能直接成为自有 Definition ID。
- [Kythe](https://github.com/kythe/kythe)：借鉴 Definition/Relation 与 Anchor/Evidence 分离、Fact namespace 和半开源码范围。
- [Unison](https://github.com/unisonweb/unison)：借鉴“名字不等于身份”和内容寻址缓存思想；不把内容 hash 宣称为 TS/Python 声明的跨版本永久身份。
- [CodeGraph](https://github.com/colbymchenry/codegraph)：借鉴“语法抽取与跨文件解析分阶段”、按文件摘要替换派生产物、未解析项显式保留。

### 决策

首个切片只做 Tree-sitter TS/Python core。SCIP 是 core 成功后的实验增强；失败只降低 Coverage，不阻塞索引。动态调用、同名冲突和无法唯一绑定的引用只能成为 Candidate/Diagnostic。

## P2：Structural Code Graph

### 主要借鉴

- CodeGraph：借鉴本地 SQLite、文件 hash 增量、抽取后解析、双向邻接索引和有界查询；不复制其 Node/Edge 枚举、物理 schema 或 mutable 单库语义。
- [Infigraph](https://github.com/intuit/infigraph)：借鉴窄 `GraphBackend`、Store 统一负责文件 hash/替换/受影响关系重解析；暂不引入 Kùzu、Neo4j、Cypher、向量或聚类。
- Kythe：借鉴 Relation 和一到多个 Evidence 的分离，不实现 VName/Entry 兼容层。
- Tree-sitter：继续直接复用，为 `CONTAINS`、`IMPORTS` 和候选 `CALLS` 提供可重放语法证据。
- SCIP/scip-typescript：通过 Adapter 导入与当前 Snapshot 匹配的已验证语义关系，不能绕过 P1 直接写库。

### 决策

自有 SQLite GraphStore 维护不可变 Snapshot、单 writer、Definition/Relation/Fact/Evidence 和双向有界邻接。先证明单仓、TS/Python、CLI/MCP 六类查询有价值，再考虑替换存储或扩语言。

## P3：Context Engine

### 主要借鉴

- [Aider repo-map](https://aider.chat/docs/repomap.html)：首要参考。借鉴全仓符号概览、依赖图排序和固定 token 预算；自有实现使用 P2 的 Definition/Relation/Evidence，不复用其聊天、提示词、缓存或 PageRank 参数。
- [RepoGraph](https://github.com/ozyyshr/RepoGraph)：借鉴窄的“定义/引用检索”和子图展平形式，不采用其 NetworkX/缓存格式或研究 Agent 集成。
- [LocAgent](https://github.com/gersteinlab/LocAgent)：借鉴“关键词 → 实体 → 有界邻域 → 证据源码”和渐进展开，不采用其模型、提示、BM25/图格式。
- CodeGraph 与 Codebase Memory：仅在冻结公开语料做输出紧凑度、工具往返和预算保护对照，不成为 P3 权威底座。
- [GitNexus 上游仓库](https://github.com/abhigyanpatwari/GitNexus)：借鉴 `maxTokens`、repo allowlist、stale-index 和多仓 registry 的产品边界。目前 GitHub 无可确认许可证，且 setup 可能写 MCP/skills/hooks，因此**暂不复制或接入**。

### 决策

P3 不建第二张图；它把 P2 查询结果编译成版本化 `ContextPackage`。同一 snapshot、recipe、预算和输入必须确定性复现，并解释每个条目的得分来源、截断和未覆盖范围。

## P4：Behavior Graph

### 主要借鉴

- [Joern](https://github.com/joernio/joern) / [Code Property Graph](https://cpg.joern.io/)：首个按需 Adapter spike，借鉴 AST、Call Graph、CFG、控制依赖、到达定义和 PDG 的分层。
- [CodeQL](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/)：作为 TypeScript/Python 对比 spike，借鉴 source/sink/barrier、局部优先和受限全局数据流；需另行审核 CLI/query pack 许可。
- [Semgrep Community Edition](https://semgrep.dev/docs/writing-rules/glossary)：可选 Finding Adapter，适合确定、局部的规则与单文件污点；不能冒充跨文件行为图。

### 决策

只有 P2 无法回答真实的“值/控制如何到达”问题时才触发 P4。外部分析结果进入独立的 Behavior namespace，携带 Adapter 版本、输入、预算、Coverage、Completeness 和 Diagnostic；无结果不等于运行时不存在路径。

## P5：Software Knowledge Graph

### 主要借鉴

- [W3C PROV-O](https://www.w3.org/TR/prov-o/)：借鉴 Entity / Activity / Agent、generated/used/attributed/derived 的 provenance 边界；本地核心仍是 SQLite/JSON，不为了标准而引入 RDF/OWL。
- [Graphify](https://github.com/Graphify-Labs/graphify)：受限 Adapter 候选，借鉴异构本地工件接入、确定性抽取和 `EXTRACTED/INFERRED` 显式分层。只接允许范围内的本地结果，不启用模型/API 路径，不把其 graph JSON 当 Canonical IR。
- [OpenTelemetry](https://github.com/open-telemetry/opentelemetry-specification)：P4 以后可选的动态 Evidence Adapter，借鉴 Resource、Span、时间窗和语义约定；一次 trace 只能证明“观察到”，不能证明静态依赖或完整行为。

### 决策

自有 `Fact + Evidence + AdapterRun + Snapshot` 是事实核。源码、声明、运行观测、启发式和 LLM 产物必须使用不同 certainty；每次导入记录版本、配置、输入/输出 digest 和诊断。

## P6：Capability Graph

### 主要借鉴

- [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/)：首要参考。借鉴 `Domain → System → Component/API/Resource` 分层、声明式 YAML、正反关系和 freshness；可做只读 Catalog Adapter，但不嵌入整个 Portal，也不把 owner 当权限。
- Graphify：聚类和报告仅生成 `CapabilityCandidate`，必须回链 P5 Evidence 并经过人工接受、修改、合并或拒绝。
- GitNexus：只借影响、聚类、流程等查询分面的产品思路；在许可证明确前不复制、不分发、不链接为产品依赖。

### 决策

目录结构、社区聚类和模型摘要都不能自动发布为 Capability。Capability 的稳定身份、证据集合、人工决策与“拒绝后不得自动复活”规则归自有实现。

## P7：Cognitive Compiler

### 主要借鉴

- [Archify](https://github.com/tt-a1i/archify)：**直接复用为构建期展示器**。自有 Cognitive Compiler 输出带 Evidence 的 typed JSON，再由 Archify validate/deliver 生成架构、流程、时序、数据流、自包含 HTML 和源码深链。Archify 不负责推断事实。
- [Structurizr](https://docs.structurizr.com/)：借鉴“模型与视图分离”和 C4 的系统上下文/容器/组件认知分辨率。旧公开 CLI/Lite/UI 已归档，不作为默认运行时依赖。
- [Understand Anything](https://github.com/Egonex-AI/Understand-Anything)：借鉴探索、搜索、提问和按层深入的体验；其 Tree-sitter + LLM hybrid 图和摘要不进入权威数据层。

### 决策

P7 的核心是自有 Projection/Story 编译器：根据用户、任务、预算和已接受事实决定展示什么、为何展示及省略什么。Archify 只做本地校验和渲染；视觉正确不能替代语义正确。

## 快速原型实际采用清单

当前只实施 P0～P2，依次为：

1. **Tree-sitter：现在直接复用**，构建 TS/Python Definition/Evidence 抽取。
2. **SQLite：自有 GraphStore**，实现不可变 Snapshot、单 writer、增量等价和六类 CLI/MCP 查询。
3. **CodeGraph：现在重点读源码和做独立对照**，借它的工程拆分，不复制其领域模型。
4. **Kythe：现在校验 IR/Evidence 边界**，不增加运行依赖。
5. **scip-typescript：core 跑通后做可选 Adapter**，用于验证编译器级语义增益。
6. **Archify：原型需要展示和验收架构图时直接复用**，但它只消费已验证的投影结果。

其余项目全部等相应阶段的真实瓶颈出现后再接，不为“以后可能有用”提前安装。

## 来源与详细研究

- [P0～P2 开源借鉴地图](open-source-map-p0-p2.md)
- [P3 Context Engine / P4 Behavior Graph 开源参考地图](open-source-map-p3-p4.md)
- [P5～P7 开源能力地图](open-source-map-p5-p7.md)

