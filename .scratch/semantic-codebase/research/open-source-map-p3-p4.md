# P3 Context Engine / P4 Behavior Graph 开源参考地图

> 对应票据：[研究 P0～P7 开源项目能力地图](../issues/16-research-open-source-stage-map.md)。
>
> 范围：只为 **P3 Context Engine** 与 **P4 Behavior Graph** 选择可借鉴的开源先例；所有结论只依据项目官方仓库或官方文档。本文不改变 V0.1（P0～P2）的边界，也不授权引入外部运行时、联网服务或非本地源码处理。

## 结论先行

P3 不应把“生成一段上下文”做成第二套图谱：应消费 P2 已冻结、带 Evidence 和 Coverage 的结构查询结果，按任务、种子、关系方向和 token 预算产出一个可复现的 `ContextPackage`。首个原型借鉴 **Aider** 的“全仓符号概览 + 依赖图排序 + 固定 token 预算”思想；**Codebase Memory** 与 **GitNexus** 只作为 MCP 产品边界、预算保护和评测对照，不能成为权威底座。

P4 是按问题触发、可失败且显式标注不完备性的行为分析层，不把 CFG、DDG、PDG 或污点边混进 P2 的确定结构关系。首选调研/验证路线是 **Joern/CPG Adapter**（快速获得 AST/CFG/PDG/数据流语义）；对 TypeScript/Python 的安全/值流问题另设 **CodeQL Adapter** spike。**Semgrep** 适合作为确定、局部的规则 Finding Adapter，不足以充当跨文件行为图。**RepoGraph** 和 **LocAgent** 是研究原型：只借其检索/呈现思想，不能直接作为产品依赖。

## 采用顺序与硬边界

| 顺序 | 阶段 | 目标 | 借鉴组合 | 触发条件 |
| --- | --- | --- | --- | --- |
| 1 | P3 原型 | 在预算内把 P2 查询结果组织为可读上下文 | Aider（排序/预算）+ P2 自有 GraphStore | P2 的 Benchmark/真实 Agent 已显示反复的多查询组合和上下文冗余 |
| 2 | P3 对照 | 验证 MCP 包大小、截断与任务效果 | Codebase Memory、GitNexus（仅黑盒对照/思想） | 有冻结 Corpus、相同 Agent profile 与可比较任务；不接入私有源码 |
| 3 | P4 spike | 选择首个行为 Adapter 和最小行为 IR | Joern/CPG、CodeQL | P2 的 CALLS/IMPORTS 无法回答“值/控制如何到达”的真实问题，且用例已定义 source/sink 或目标路径 |
| 4 | P4 规则补充 | 输出可定位的危险模式或项目约束 Finding | Semgrep | 规则目标明确、可以接受 CE 的单文件边界，或已具备相应许可/服务条件 |

共同硬边界：每个 P3 Package 和 P4 结果必须携带 `repository_id`、`snapshot_id`、输入查询/配置 digest、Adapter 版本、Evidence、Coverage/Completeness、预算消耗和 Diagnostic。未发现路径只能表示“在该分析范围内未发现”，不能宣称运行时不存在；动态分派、反射、插件注册、外部库和未建模框架必须保留为限制。

## P3 Context Engine

| 项目 | 官方链接与已核验能力 | 对 P3 可借能力 | 采用方式 | 不照搬内容 | 采用前置条件 |
| --- | --- | --- | --- | --- | --- |
| Aider repo-map | [repo-map 文档](https://aider.chat/docs/repomap.html)说明它给模型提供全仓文件清单与关键符号/签名，并用依赖图排序选择符合 token 预算的片段；[实现](https://github.com/Aider-AI/aider/blob/main/aider/repomap.py)可见其排序与缓存入口。 | `ContextPackage` 的最小形态：符号卡片（名称、签名、所在文件、短源码锚点）+ 任务种子周围的关系摘要；在预算不足时按任务相关性截断，而不是按文件顺序硬切。 | **借思想。** 自有 P3 使用 P2 Definition/Relation/Evidence 计算排序，并版本化 `recipe_id + ranking_config_digest`。 | 不复用 Aider 的聊天状态、编辑流程、模型提示、其 tree-sitter tag 查询、缓存实现或 PageRank 参数；更不把文本 repo-map 当作事实源。 | P2 six-query 接口与 Snapshot 语义稳定；先在冻结 Corpus 上比较“无包 / 固定符号包 / 关系排序包”的答案质量、token、读取文件数和截断率。 |
| CodeGraph | [官方 README](https://github.com/colbymchenry/codegraph/blob/main/README.md#how-it-works)说明其 AST/解析/本地 SQLite 图与面向 Agent 的查询方式；本项目已在 P0～P2 将它定位为实现参考与对照，非权威 Adapter。 | “图查询结果应被编排为任务上下文，而非直接暴露存储细节”的产品验证对象；可对照其 context/query 输出是否足够帮助 Agent 决定下一步。 | **暂不采用（P3 生产依赖）。** 仅作为公开 Corpus 上的比较组/实现参考。 | 不嵌入其数据库、MCP 输出、watcher、节点/边枚举和 heuristic resolver；不得让其结果绕过自有 Snapshot、Evidence 或 Completeness 契约。 | 只在固定公开 commit 与相同 Agent profile 下做黑盒比较；任何差异必须回到源证据，不能以其输出作 Gold。 |
| Codebase Memory MCP | [官方仓库](https://github.com/DeusData/codebase-memory-mcp)声明其将代码索引为持久知识图，并暴露结构查询、影响与路径等 MCP 工具；其[安全说明](https://github.com/DeusData/codebase-memory-mcp/blob/main/SECURITY.md)同时说明会深度访问文件系统、写 Agent 配置并启动后台更新检查。 | MCP 查询命名、图查询→紧凑结果的取舍、按响应预算限制内容，以及 P3/P2 效果评测的对照维度。 | **暂不采用（生产依赖）；借思想/黑盒对照。** | 不安装其二进制、不执行安装脚本、不写入 Agent 配置、不启动后台服务；不复用其全语言 Graph、Hybrid LSP 或任意 Cypher 作为自有 Canonical IR。 | 必须先得到用户对运行外部二进制/写配置的单独授权；比较仅可在冻结公开仓库与隔离环境进行，并记录版本、工具表与默认网络行为。 |
| GitNexus | [上游仓库](https://github.com/abhigyanpatwari/GitNexus)及其 README 记录响应预算、stale-index、MCP 与多仓 registry；`nxpatterns/gitnexus` 是该上游的 fork。核验时上游与 fork 的 GitHub license 元数据均为 `NOASSERTION`。 | 将 `maxTokens` 视为 transport guardrail 而非语义分页；显式 repo allowlist、stale-index 提示、图上下文 enrichment 的可用性验证。 | **暂不采用；只借思想。** 单仓 P3 只引入显式预算、Snapshot 新鲜度与完整性说明；许可证明确前不复制、分发或链接其实现。 | 不采用其全局 registry、自动写入 `AGENTS.md`/hook/MCP 配置、embeddings、图数据库、浏览器 UI 或跨仓默认可见性。 | 许可证先得到上游明确补全；P2 能稳定返回 stale/ready 状态；P3 预算单位、截断策略和 Evidence 保留规则已在本地 Agent Smoke 中冻结。 |
| RepoGraph | [官方仓库](https://github.com/ozyyshr/RepoGraph)表明它构造 `tags_*.jsonl` 与 NetworkX 图，并以一个 `search_repo` 动作为 Agent 返回定义/引用关系；仓库也明确提示当前版本构图可能较慢。 | 一个窄而明确的“按符号检索定义/引用”动作，以及把子图展平成 Agent 易读输出的对照。 | **借思想。** | 不采用其 Python/NetworkX 图、pickle/JSONL 缓存、SWE-agent/Agentless 集成或单一关键词 `search_repo` 作为 P3 API。 | 只在 P2 精确查询已证明不足、且评测显示一个版本化 Recipe 可稳定减少工具往返时，再增加高层 Recipe。 |
| LocAgent | [官方仓库](https://github.com/gersteinlab/LocAgent)将代码解析为有向异构图，并以图搜索与 BM25 索引辅助定位；其运行说明依赖预建 graph/BM25 index 和模型调用。 | 多跳定位任务应把“关键词 → 实体 → 有界邻域 → 证据源码”拆开；输出可按 `fold / preview / full` 等细粒度逐步展开。 | **借思想。** | 不采用其任务规划提示、模型微调、BM25/图索引格式、自动下载仓库、云模型/基准运行流程或其“定位准确率”作为本产品指标。 | 先有 P3 任务分类与匿名化的真实失败样本；若加入文本检索，必须证明它不会越过 P2 Snapshot、文件范围和隐私边界。 |

### P3 最小原型

1. 输入：任务文本（或显式 seed Definition）和固定 `max_tokens`。
2. 规划：把任务映射为**可审计的** P2 查询序列；没有可解释 mapping 时返回候选与 Diagnostic，而非隐式“理解”。
3. 排序：先保留 seed、直接定义 Evidence、目标方向一跳关系和瓶颈节点；每个条目记录得分来源（命中、关系距离、kind、导出性），不把模型相关性混入事实分数。
4. 输出：`ContextPackage` 中按摘要→关系→源码 Evidence 渐进展开；明确 `truncated`、未覆盖语言/文件、heuristic 来源与 Snapshot 状态。
5. 验收：同一 snapshot、recipe、预算与输入重复运行字节级确定；Agent 的读取文件数/Token 不上升且正确率不下降才保留 Recipe。

## P4 Behavior Graph

| 项目 | 官方链接与已核验能力 | 对 P4 可借能力 | 采用方式 | 不照搬内容 | 采用前置条件 |
| --- | --- | --- | --- | --- | --- |
| Joern / Code Property Graph | [Joern 官方仓库](https://github.com/joernio/joern)说明它面向 C/C++、Java、Binary、JavaScript、Python、Kotlin 的 CPG 分析；[CPG 规范](https://cpg.joern.io/)把 CPG 定义为有向、带边标签、带属性的多重图，并定义 AST、CallGraph、CFG、PDG 等层。规范中 `REACHING_DEF` 记录变量未被重赋值时的到达定义，PDG 由数据/控制依赖组成。 | 行为分析的分层模型：语法/调用 → CFG → 控制依赖 → 到达定义/数据依赖；以及“语言前端、覆盖层、输入 hash、分析 Finding”都必须成为可追溯元数据。 | **Adapter（首选 P4 spike）。** 把一次 Joern Run 视为外部分析输入，只转换被请求的路径/节点/诊断为自有 `BehaviorFact`、`BehaviorRelation`、Evidence；不让 CPG 成为主存储。 | 不复制/替换 P2 的 SQLite GraphStore，不暴露 Scala DSL/CPG schema，不默认全仓 CPG，不把数据流近似输出成确定事实；不将 Binary/C/C++ 能力扩展为 P4 首期范围。 | 有至少 5 个冻结 TypeScript/Python 行为问题（含 expected evidence 与“不可判定”样例）；确认 Joern 对目标语言/版本的实际覆盖；本机 JDK 21 与离线可重复的运行命令可用；先比较成本、精度和路径可读性。 |
| CodeQL | [GitHub 官方文档](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning)说明 CodeQL 先建数据库后运行查询，支持 JavaScript/TypeScript 与 Python；[官方数据流文档](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/)区分局部与全局数据流，并明确全局流更耗时且需限定 source/sink。 | `source + sink + barrier/sanitizer + path` 的按需配置方式；局部先行、全局仅针对问题的性能纪律；数据流边是运行时可能值传播的近似，不等于 AST 关系。 | **Adapter（TypeScript/Python 对比 spike，非默认运行时）。** 执行版本固定的自定义 query pack，转换 path-query 的位置和规则 ID 为自有 Finding/Evidence。 | 不将 CodeQL database、QL query、默认安全 suite、GitHub Code Scanning 上传/CI 或其许可条件嵌入产品契约；不承诺所有语言/框架、也不把一个 query 的无结果解释为无行为。 | 每个行为问题有明确 source/sink 与可接受的建模边界；数据库构建命令/依赖可在离线 checkout 重放；先审核 CodeQL CLI/pack 的当前许可与分发条件；性能上限与取消机制须先定义。 |
| Semgrep Community Edition | [官方规则术语](https://semgrep.dev/docs/writing-rules/glossary)说明 rule 可为 search 或 taint，taint 指定 source/sink/propagator/sanitizer；同一官方文档明确 CE 仅 per-file，不能做 interfile analysis；[CE 原则](https://semgrep.dev/docs/contributing/semgrep-philosophy)强调确定、可离线、单文件分析。 | 快速、确定的源码模式/局部污点 Finding；把规则 ID、命中位置、source/sink/propagator/sanitizer 作为可审计 Evidence，而不是伪造跨文件行为边。 | **Adapter（可选规则补充）。** 对已定义的项目约束或安全模式运行版本锁定的本地规则集，向 P4 写入 `Finding`，必要时只附单文件路径。 | 不把 CE 当作跨仓/跨文件行为图；不照搬/自动下载规则集，不接入 SaaS/Pro Engine，不让 `pattern` 匹配直接改变 P2 Definition/Relation。 | 规则和预期 Finding 先进入 fixture；规则许可证、版本和语言支持通过审核；产品界面显示“single-file / rule-scoped”覆盖范围。 |

### P4 统一接入契约（先于任何 Adapter）

```text
BehaviorAnalysisRequest
  = snapshot + scope + analysis_kind + seeds/source/sink + budgets + adapter_config_digest

BehaviorAnalysisResult
  = status + coverage + completeness + findings/paths
  + evidence[] + adapter_run(version, command/config digest, diagnostics)
```

- `analysis_kind` 首期只允许 `control_flow`、`data_flow_path`、`taint_path`、`rule_finding`；每一种必须显式声明近似、最大深度/节点数、超时与取消。
- `BehaviorRelation` 与 P2 Relation 分表/分 namespace，默认不可参加 P2 的 `callers`、`impact` 或 Benchmark Gold；P3 需要使用时必须在 Package 中标注其 Adapter、范围和不确定性。
- 适配器失败、超时、缺语言前端、未建模库、无法解析动态调用均返回结构化 Diagnostic；不得偷偷回退为字符串搜索结果。

## 暂缓清单与复审条件

- **Codebase Memory、GitNexus 作为生产依赖：** 暂缓。前者拥有独立索引/生命周期/配置写入与图模型，后者还缺少可确认许可证。仅当产品方向改为“集成现有本地 code-intelligence 产品”、GitNexus 许可证边界明确，且用户授权安装/配置副作用时复审。
- **RepoGraph、LocAgent 作为生产依赖：** 暂缓，原因是其公开实现以研究/benchmark 集成为主，缺少与自有 Snapshot、Evidence、隐私与确定性契约的直接适配。仅当 P3 的冻结评测证明图格式/高层检索策略有稳定收益时复审其思想。
- **Joern/CodeQL 的默认全仓运行：** 暂缓。P4 的价值是解决已知行为问题，不是为每个 Snapshot 支付全量控制/数据流成本；只有问题触发、预算和语言覆盖已知时才运行。
- **Semgrep 作为行为图：** 不采用。CE 的官方单文件限制决定它可提供 Finding，但不能支撑跨文件路径或全仓值流结论。

## 研究记录

- 核验日期：2026-08-17（Asia/Shanghai）。
- 来源限制：仅项目官方 GitHub 仓库、项目官方文档或官方规范；未把搜索结果、博客转载或第三方测评作为能力依据。
- 本文是架构采用建议，不是许可证法律意见。实际引入任一可执行二进制、query pack、规则集、SaaS/账户或会写入 Agent 配置的安装步骤前，必须独立完成许可、安全与副作用审查。
