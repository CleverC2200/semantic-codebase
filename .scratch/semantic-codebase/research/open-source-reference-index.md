# Semantic Codebase 开源参考索引

> 核对日期：2026-08-25（Asia/Shanghai）。范围包括现有研究资产、`references/codegraph/` 本地源码、已固定到冻结提交的 `references/zod/`，以及这些资产已链接的官方仓库/官方文档。早期 Semantic Codebase 原型已退役，只在历史验收收据和本地发布前 Git bundle 中保留证据。本文件不是许可证法律意见。
>
> 当前边界：CodeGraph 和 Zod 都只是 Reference/测试语料；“早期原型曾落地”是历史状态，不代表当前顶层产品的采用情况。

## 查询说明

这是“**参考过什么、为什么参考、现在是否采用**”的索引，而非依赖清单。查询时先看 P0–P7 阶段表，再按项目 A–Z 查能力、结论、证据和复审闸门。`当前落地证据`只指本工作区可见的产品实现；研究文档里的“直接复用/Adapter”若尚未有代码或锁定依赖，一律仍是计划，不写成已落地。

可视化入口：[Semantic Codebase P0–P7 开源能力与实施地图](semantic-codebase-stage-map.html)。

常用查询：

```bash
# 查某个项目
rg -n "CodeGraph|SCIP|Joern" .scratch/semantic-codebase/research/open-source-reference-index.md

# 查采用状态
rg -n "已落地|已定计划|借鉴设计|受限 Adapter|暂缓/不采用" \
  .scratch/semantic-codebase/research/open-source-reference-index.md

# 查某个阶段
rg -n "P2|Structural Code Graph" .scratch/semantic-codebase/research/open-source-reference-index.md

# 查实际代码证据
rg -n "当前落地证据|references/zod|早期原型" \
  .scratch/semantic-codebase/research/open-source-reference-index.md
```

### 采用状态图例

| 标记 | 含义 |
| --- | --- |
| **早期原型曾落地** | 退役原型中曾实际使用；只由历史收据和备份取证，不代表当前顶层产品已采用。 |
| **已定计划** | 路线已接受，但尚无本产品实现/依赖。 |
| **借鉴设计** | 只借模型、边界或交互，禁止复制其协议/实现。 |
| **受限 Adapter** | 未来可导入带版本、配置、输入摘要、Evidence 的外部结果；不是当前依赖。 |
| **对照/语料** | 只用于冻结 Benchmark、公开语料或黑盒比较。 |
| **暂缓/不采用** | 身份、许可证、副作用、阶段价值或范围不满足；不进入依赖图。 |
| **历史未采用** | 曾做研究但后续决策已排除，不得据此安装或实施。 |

## P0–P7 阶段总览

| 阶段 | 调研问题与结论 | 当前采用状态 | 当前落地/复审闸门 |
| --- | --- | --- | --- |
| P0 Benchmark | 以冻结公开提交、结构内核与 Agent 双轨验证价值；不能复述外部项目数据。CodeGraph 仅独立对照。 | **对照/语料**；尚未实现 runner。 | 冻结语料已定；四外部项目仍须本地双冷启动后入库。 |
| P1 Definition Registry | Tree-sitter 是 TS/Python 共同语法基线；SCIP 是版本绑定的离线富集。 | **早期原型曾落地**；当前采用情况以顶层源码和 Spec 为准。 | [Slice 1 验收收据](../receipts/slice-1-acceptance.md) 记录了五类 Definition 抽取；原型源码已退役。 |
| P2 Structural Code Graph | 不可变 Snapshot + SQLite GraphStore 是早期方案；外部图模型只提供先例。 | **早期原型曾落地**；当前采用情况以顶层源码和 Spec 为准。 | 收据记录了 SQLite、Snapshot、Definition/Evidence；原型源码已退役。 |
| P3 Context Engine | P2 查询按任务/预算编译为可复现 `ContextPackage`，不建第二张图。 | **借鉴设计/暂缓**。 | 仅在 P2 Benchmark 显示多查询冗余后，评测 Aider 式排序配方。 |
| P4 Behavior Graph | 与 P2 分层；按问题触发 Joern/CodeQL spike，Semgrep 仅单文件 Finding。 | **受限 Adapter（计划）**。 | 先有至少 5 个冻结 TS/Python 行为题、预算和离线复放能力。 |
| P5 Software Knowledge Graph | 自有 Fact/Evidence/AdapterRun/Snapshot 为事实核；PROV-O 只提供来源词汇。 | **借鉴设计/受限 Adapter（计划）**。 | 先审计输入范围、许可、隐私和收据；动态观测需 P4 已定。 |
| P6 Capability Graph | Backstage 声明式目录可作只读 Adapter；聚类只能生成待人工审核候选。 | **受限 Adapter（计划）**。 | 先定义自有 taxonomy、冲突规则、freshness 与人工接受/拒绝流。 |
| P7 Cognitive Compiler | 自有 Projection/Story；Archify 只渲染已验证投影。 | **已定计划**。 | 每节点/边须回链已接受事实；使用前固定 snapshot、运行 validate/deliver/visual-check。 |

## 已实际落地 vs 仅规划

| 分类 | 项目/能力 | 可见证据 | 边界 |
| --- | --- | --- | --- |
| 早期原型曾落地 | Tree-sitter runtime、TypeScript grammar、Python grammar | [Slice 1 验收收据](../receipts/slice-1-acceptance.md) 与本地发布前 Git bundle | 原型源码已退役；当前采用情况以顶层源码和 Spec 为准。 |
| 早期原型曾落地 | SQLite（Node 24 `node:sqlite`）GraphStore | [Slice 1 验收收据](../receipts/slice-1-acceptance.md) 与本地发布前 Git bundle | 原型源码已退役；不决定当前产品存储方案。 |
| 本地参考，不是依赖 | CodeGraph | `references/codegraph/package.json:1-61`；`references/codegraph/README.md:473-502` | 本地源码快照是实现参考/P0 对照；不得作为 Semantic Codebase 运行时 Adapter。 |
| 仅规划 | SCIP、scip-typescript、Joern、CodeQL、Semgrep、Backstage、Graphify、OpenTelemetry、Archify | P1–P7 研究表及阶段闸门 | 没有产品锁定依赖、Adapter、二进制或服务配置。 |
| 仅规划/借鉴 | Aider、Infigraph、Kythe、Unison、RepoGraph、LocAgent、Structurizr、Understand Anything、PROV-O | 各阶段研究表 | 不复制协议、存储格式、模型输出或 UI。 |
| 仅语料/评测研究 | Zod、Socket.IO、Poetry、Textual、CrossCodeEval、RepoBench、SWE-bench | 冻结 Corpus/Benchmark 方法 | 四个真实项目未在本机拉取；前三项评测项目不成为产品依赖。 |
| 暂缓或历史未采用 | Codebase Memory、GitNexus、本地 Qwen/Ollama/llama.cpp/vLLM | 对应研究结论 | 不安装、不写 Agent 配置、不启动 daemon/模型。 |

## 已完成的调研与决策

| 调研主题 | 研究了什么 | 已形成结论 | 查询入口 |
| --- | --- | --- | --- |
| Benchmark 方法与样本组合 | Fixture、CodeGraph 自举、外部真实项目、Gold 隔离、结构内核与 Agent 两条轨道 | 日常先验证确定性事实；内部只强制 64-run Smoke，完整 960-run Evidence Benchmark 按需另开 Epoch | [`benchmark-method-and-corpus.md`](benchmark-method-and-corpus.md)、[`04`](../issues/04-decide-benchmark-contract.md)、[`15`](../issues/15-decide-benchmark-execution-profile.md) |
| TS/Python 抽取路线 | Tree-sitter、SCIP、scip-typescript/scip-python、LSP、CodeGraph | Tree-sitter 是 `core`；scip-typescript 是后置实验 Enricher；CodeGraph/LSP 不作权威运行时 Adapter | [`extraction-adapters.md`](extraction-adapters.md)、[`02`](../issues/02-research-extraction-adapters.md)、[`09`](../issues/09-decide-source-adapter-seam.md) |
| 图模型、存储与查询 | Kythe、SCIP、Unison、Infigraph、CodeGraph、SQLite/图数据库先例 | 自有不可变 Snapshot、Definition/Relation/Fact/Evidence；SQLite 足够完成 V0.1，不公开 SQL/Cypher | [`graph-precedents.md`](graph-precedents.md)、[`03`](../issues/03-research-graph-precedents.md)、[`08`](../issues/08-decide-graph-store-query-interface.md) |
| Definition 身份与 Canonical IR | 跨版本身份、五类 Definition、七类 Relation、Evidence/Fact | Definition Key 只在 Snapshot 内稳定；不提前实现 Lineage、行为图和 Capability | [`05`](../issues/05-decide-definition-identity.md)、[`06`](../issues/06-decide-canonical-ir.md) |
| Snapshot 与增量生命周期 | Manifest、Ready 指针、失败恢复、Freshness、全量/增量等价 | `building → ready/failed/superseded`，单 writer，原子发布；增量只是可与全量对照的优化 | [`07`](../issues/07-decide-index-snapshot-lifecycle.md) |
| CLI/MCP 查询契约 | 单一 Explore 与六个精确查询的交互原型、Scope、预算、错误和 JSON | 采用六个精确 Query Interface；CLI/MCP 共用 Contract，不提供模糊 `impact` 或通用查询语言 | [`10`](../issues/10-prototype-cli-mcp-contract.md)、[`交互原型`](../prototypes/cli-mcp-contract.html) |
| Benchmark Corpus 冻结 | Zod、Socket.IO、Poetry、Textual、CodeGraph 固定提交及淘汰候选 | 固定提交、锁文件、排除规则和双冷启动闸门已记录；外部四仓尚未本机入库 | [`frozen-benchmark-corpus.md`](frozen-benchmark-corpus.md)、[`13`](../issues/13-research-freeze-benchmark-corpus.md) |
| 验证与交付门槛 | Fixture、确定性、增量、CLI/MCP、隐私、真实项目演示、Agent Smoke | 先过轻量 Prototype Gate；方向确认后再过 G1–G4 Release Gate | [`11`](../issues/11-decide-validation-release-gates.md)、[`实施交接`](../v01-implementation-handoff.md) |
| 本地 Agent 模型路线 | Ollama、Qwen、llama.cpp、vLLM 的资源与复现性 | 历史研究未采用；不部署本地模型，Benchmark 使用现有 Codex | [`local-agent-runtime.md`](local-agent-runtime.md)、[`14`](../issues/14-research-local-agent-runtime.md) |
| P0–P7 开源能力地图 | 从 Benchmark、Definition、Structural/Behavior Graph 到 Capability/Cognitive Compiler 的项目先例 | 外部项目只能处于依赖、Adapter、候选、对照或展示层；Semantic/Evidence/Capability Model 自有 | [`open-source-capability-map.md`](open-source-capability-map.md)、[`16`](../issues/16-research-open-source-stage-map.md) |

## 项目 A–Z 索引

| 项目（阶段） | 官方链接 | 调研问题 / 已核验能力 | 结论与采用状态 | 当前落地证据 | 复审条件 |
| --- | --- | --- | --- | --- | --- |
| Aider repo-map（P3） | [文档](https://aider.chat/docs/repomap.html) / [源码](https://github.com/Aider-AI/aider) | 全仓符号概览、依赖图排序与 token 预算。 | 任务相关排序/截断的**借鉴设计**；不复用提示、缓存或参数。 | 无。 | P2 六查询/Snapshot 稳定，并在冻结 Corpus 比较答案质量、token、读取文件数、截断率。 |
| Archify（P7） | [tt-a1i/archify](https://github.com/tt-a1i/archify) | typed JSON → validate/deliver/visual-check → 自包含架构工件。 | P7 构建期展示器的**已定计划**；不作为事实推断器。 | 无 Semantic Codebase 接入。 | 节点/边均有已接受 Evidence；固定 snapshot 并完成 validate/deliver/visual-check。 |
| Backstage Software Catalog（P6） | [官方文档](https://backstage.io/docs/features/software-catalog/) / [仓库](https://github.com/backstage/backstage) | `Domain/System/Component/API/Resource`、声明式 YAML、正反关系、freshness。 | **受限 Adapter + 借鉴设计**；不嵌 Portal/权限系统。 | 无。 | 自有 taxonomy、可读目录、namespace/冲突规则和 YAML Evidence/freshness 先确定。 |
| Codebase Memory MCP（P0/P2/P3） | [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | 持久图、MCP、daemon/watcher；名称身份不唯一且安装会读文件、写 Agent 配置、启后台。 | **暂缓/不采用**；仅保留单 writer、生命周期、预算对照观察。 | 无。 | 项目身份明确、用户单独授权外部二进制/配置副作用，且仅在隔离公开仓比较。 |
| CodeGraph（P0–P3） | [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) | Tree-sitter 抽取→SQLite/FTS5→解析→图查询/MCP；本地副本 MIT。 | **借鉴设计 + P0 对照/自举语料**；非产品运行时依赖。 | 本地 `references/codegraph/`；产品未依赖它。 | 仅固定公开 commit、相同 Agent profile 黑盒比较；输出不得作 Gold 或绕过自有 Snapshot/Evidence。 |
| CodeQL（P4） | [官方文档](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/) | TS/Python 数据库与局部/全局 data-flow、source/sink/barrier/path。 | **受限 Adapter（对比 spike）**，非默认运行时。 | 无。 | 冻结行为题和 source/sink、离线构建、性能/取消上限；另审 CLI/query-pack 当前许可。 |
| CrossCodeEval（P0 方法） | [官方页](https://crosscodeeval.github.io/) | 静态筛选跨文件样本，分开报告代码与标识符匹配。 | **评测方法参考**，不采用为产品能力。 | 无。 | 仅其方法可由自有冻结题目/Gold/收据复算。 |
| GitNexus（P3/P6） | [上游](https://github.com/abhigyanpatwari/GitNexus) | maxTokens、stale-index、多仓 registry、MCP/skills/hooks；上游许可证记录为 NOASSERTION。 | **暂缓/不采用**；只借预算、新鲜度、单进程边界的设计。 | 无。 | 上游许可证明确且完成安全/可重复性审查；隔离、无凭据、无自动安装评估。 |
| Graphify（P5/P6/P7） | [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | 异构工件图、Tree-sitter、本地直接抽取与推断分层；许可曾变化。 | **受限 Adapter**；结果只作 Evidence/Capability 候选。 | 无。 | 固定提交和许可证文本；离线、允许范围输入、敏感数据/网络审计、可重复导入和 Evidence 抽样。 |
| Infigraph（P2） | [intuit/infigraph](https://github.com/intuit/infigraph) | 窄 `GraphBackend`、文件 hash、替换和受影响边重解析；Kùzu/Neo4j 后端。 | **借鉴设计** GraphStore 边界；不引入 Kùzu/Neo4j/Cypher。 | 自有 `GraphStore` 已存在，未使用 Infigraph。 | 仅当 SQLite 有实测规模/多仓瓶颈才评估后端替换。 |
| Joern / Code Property Graph（P4） | [Joern](https://github.com/joernio/joern) / [CPG spec](https://cpg.joern.io/) | AST/CallGraph/CFG/PDG/REACHING_DEF 分层。 | **首选受限 Adapter spike**；不取代 P2 Store。 | 无。 | 至少 5 个冻结行为题，实际语言覆盖，JDK 21 与离线可重复命令，比较成本/精度/路径可读性。 |
| Kythe（P1/P2） | [Kythe](https://github.com/kythe/kythe) / [Storage Model](https://kythe.io/docs/kythe-storage.html) | VName、Fact、Edge 与 Anchor/Evidence 分离、半开 byte range。 | **借鉴设计**；不兼容 VName/Entry schema。 | 自有 Evidence 存 byte span，见 `src/store/graph-store.ts:47-61`。 | 仅作为 IR/Evidence 边界复核，无引入计划。 |
| Language Server Protocol（P1） | [LSP](https://microsoft.github.io/language-server-protocol/) | 编辑器与语言服务器 JSON-RPC，非可复现仓库索引格式。 | **暂不纳入 V0.1 权威抽取**；后续仅临时诊断证据。 | 无。 | 需要交互诊断且能管理 server、workspace、解释器、未保存 buffer 与版本。 |
| LocAgent（P3） | [gersteinlab/LocAgent](https://github.com/gersteinlab/LocAgent) | 关键词→实体→有界邻域→证据、图搜索和 BM25。 | **借鉴设计**，不采用模型/BM25/图格式。 | 无。 | 有匿名真实失败样本；文本检索不越过 P2 Snapshot、文件范围和隐私边界。 |
| Nest（P0 Corpus） | [nestjs/nest](https://github.com/nestjs/nest) | 冻结候选有 1,684 个 TS 文件。 | **淘汰语料候选**：超出 80–800 文件上限。 | 无。 | 仅调整已定 Corpus 尺度政策时重评，不能降低阈值迁就项目。 |
| Ollama / Qwen2.5-Coder / llama.cpp / vLLM（P0 runtime） | [Ollama](https://github.com/ollama/ollama) / [Qwen](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct) / [llama.cpp](https://github.com/ggml-org/llama.cpp) / [vLLM](https://github.com/vllm-project/vllm) | 曾调研本地 Agent Benchmark 主/降级运行环境。 | **历史未采用**：用户决定不部署/维护本地模型。 | 本机未安装；路线改用现有 Codex。 | 仅在用户重新明确授权本地模型/下载/运行时后，按冻结 manifest 重新准入。 |
| OpenTelemetry（P5） | [规范](https://opentelemetry.io/docs/specs/otel/trace/api/) | Span DAG、Resource、时间窗和语义约定，可表达运行观测。 | **受限 Adapter（后置）**；观测只能证明 observed。 | 无。 | P4 已定义冲突语义；授权、脱敏、采样、保留/删除路径和 snapshot binding 获批。 |
| Poetry（P0 Corpus） | [python-poetry/poetry](https://github.com/python-poetry/poetry) | 冻结 Python CLI 语料：MIT，commit `811a12d…`。 | **对照/语料**，未作依赖。 | 未在本机拉取；冻结清单有复放命令。 | 本地双冷启动通过，否则淘汰，不漂移版本。 |
| PROV-O（P5） | [W3C Recommendation](https://www.w3.org/TR/prov-o/) | Entity/Activity/Agent 与 generated/used/attributed/derived 来源词汇。 | **借鉴设计**；不是需集成的软件依赖。 | 无。 | 先有最小 Evidence/Agent/digest/retention 语义；跨系统交换需求出现才设计导出。 |
| RepoBench（P0 方法） | [Leolty/repobench](https://github.com/Leolty/repobench) | 区分第一次跨文件、随机跨文件和文件内使用。 | **评测方法参考**。 | 无。 | 仅映射到自有题目分层，不复制其任务/成绩。 |
| RepoGraph（P3） | [ozyyshr/RepoGraph](https://github.com/ozyyshr/RepoGraph) | 定义/引用检索与子图可读展平；NetworkX/JSONL 缓存。 | **借鉴设计**；不作为 P3 API/依赖。 | 无。 | P2 精确查询不足且冻结评测证明版本化高层 Recipe 减少往返。 |
| SCIP / scip-typescript / scip-python（P1/P2） | [SCIP](https://github.com/scip-code/scip) / [TS indexer](https://github.com/sourcegraph/scip-typescript) / [Python indexer](https://github.com/sourcegraph/scip-python/tree/scip) | 完整 `Index`、Occurrence、symbol/relationship；TS 是首个候选，Python 依赖解释器/环境。 | **已定计划的受限 Adapter**；core 不依赖，Python 仍实验性。 | 无包、无 importer；`PROFILE` 固定为 `core`，见 `src/indexing/index.ts:7-18`。 | core 通过后，生成完整 `index.scip`；校验 repo revision/content hash、记录 tool/config。显式请求 `core+scip-ts` 而 Adapter 失败时 Snapshot 必须失败，调用方只能显式改用 `core` 重建，不得静默降级。 |
| Semgrep CE（P4） | [官方术语](https://semgrep.dev/docs/writing-rules/glossary) | 确定、离线、单文件 search/taint Finding；CE 不做 interfile。 | **受限 Adapter（规则补充）**，不是行为图。 | 无。 | 规则/fixture/许可/版本/语言支持先冻结；UI 显示 single-file/rule-scoped coverage。 |
| Socket.IO（P0 Corpus） | [socketio/socket.io](https://github.com/socketio/socket.io) | 冻结 TS 多包语料：MIT，commit `9978574…`。 | **对照/语料**，未作依赖。 | 未在本机拉取。 | 本地双冷启动与锁文件/官方 CI 命令验证。 |
| SQLite（P2） | [SQLite](https://www.sqlite.org/) | WAL、单 writer、双向邻接/有界遍历、FTS5 只作候选检索。 | **已落地**：通过 Node 24 内置 `node:sqlite` 的自有 Store。 | `src/store/graph-store.ts:3,28-88`；WAL/外键已设置。 | Relation/FTS/遍历仍是后续切片；性能瓶颈前不换图后端。 |
| Structurizr（P7） | [官方文档](https://docs.structurizr.com/) | 模型与视图分离、C4 分辨率；旧公开工具已归档。 | **借鉴设计**，不作为运行时依赖。 | 无。 | 未来 vNext 需独立核验许可证、离线能力、迁移与安全模型。 |
| SWE-bench（P0 方法） | [SWE-bench](https://github.com/SWE-bench/SWE-bench) | fail-to-pass/回归测试、评测仓与训练仓不重叠、容器化评估。 | **评测方法参考**。 | 无。 | 自有 evaluator/manifest/trace 才能形成结论。 |
| Textual（P0 Corpus） | [Textualize/textual](https://github.com/Textualize/textual) | 冻结 Python TUI 语料：MIT，commit `1d99508…`。 | **对照/语料**，未作依赖。 | 未在本机拉取。 | 本地双冷启动、固定 lock/CI 复放。 |
| Tree-sitter + TS/Python grammars（P1/P2） | [Tree-sitter](https://github.com/tree-sitter/tree-sitter) / [TS grammar](https://github.com/tree-sitter/tree-sitter-typescript) / [Python grammar](https://github.com/tree-sitter/tree-sitter-python) | parser generator + incremental CST；声明候选、范围、语法证据。 | **已落地**的共同语法基线。 | 精确版本 `0.21.1/0.23.2/0.21.0` 在 `package.json:15-17`，解析与规则在 `tree-sitter-adapter.ts:1-99`。 | 跨文件 binding/类型语义仍需 resolver 或经校验的 SCIP，不能由 CST 推断。 |
| Unison（P1/P2） | [unisonweb/unison](https://github.com/unisonweb/unison) | 内容寻址代码与显示名称分离。 | **借鉴设计**，不是 TS/Python 索引器。 | Snapshot/Definition Key 是自有实现，见 `src/indexing/index.ts:14-25,45-55`。 | 仅在未来跨 Snapshot lineage/缓存需求出现时复盘。 |
| Understand Anything（P7） | [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) | 探索/搜索/问答/分层深入；Tree-sitter + LLM hybrid。 | **借鉴设计**，不进入事实管线。 | 无。 | 体验对照只能用隔离公开语料；P7 叙述必须来自已接受 Fact/Capability。 |
| VitePress（P0 Corpus） | [vuejs/vitepress](https://github.com/vuejs/vitepress) | 冻结候选仅 72 个 TS/TSX。 | **淘汰语料候选**：低于 80 文件下限。 | 无。 | 仅尺度政策变更时重评。 |
| Zod（P0 Corpus） | [colinhacks/zod](https://github.com/colinhacks/zod) | 冻结 TS 库语料：MIT，commit `1fb56a5…`；排除测试/基准/fixture 后为 107 个 TS/TSX 文件。 | **对照/语料**，未作依赖；当前首选真实项目测试输入。 | 本地 `references/zod/`；HEAD/tree 与冻结清单一致，已移除子仓库 `.git`。13 文件的 v3 子集已生成 Ready Snapshot；完整范围因 v4 `in`/`out` variance annotations 产生 21 个语法错误，保留为 grammar 升级门禁。 | 先解除完整范围的 grammar 兼容缺口，再执行本地双冷启动和固定 lock/CI 复放。 |

## 工作区中的开源工具

这些工具帮助研究、制图或交付，但不进入 Semantic Codebase 的事实管线或运行时依赖。

| 工具 | 当前状态 | 已做工作 | 结论与边界 | 本地证据 |
| --- | --- | --- | --- | --- |
| [Archify](https://github.com/tt-a1i/archify) | 已安装在 CodeGraph 参考目录，版本 `2.14` | 基于本地源码生成 CodeGraph runtime architecture 的 JSON、HTML、截图和 visual-check receipt | 适合“typed IR → validate → deliver → visual-check”；它只渲染已核验事实，不能替代语义判断。现有 receipt 为 `visualReview: pending`，且其中绝对路径早于工作区重构；复用前应在当前路径重跑验证 | [`SKILL.md`](../../../references/codegraph/.agents/skills/archify/SKILL.md)、[`架构 JSON`](../../../references/codegraph/docs/codegraph-runtime-architecture.json)、[`HTML`](../../../references/codegraph/docs/codegraph-runtime-architecture.html)、[`visual-check`](../../../references/codegraph/docs/codegraph-runtime-architecture.visual-check.json) |
| [diagram-design](https://github.com/cathrynlavery/diagram-design) | 已安装在根工作区，版本 `2.6` | 完整安装 206 个 Skill 文件（53 份参考规范、3 个脚本、149 个示例/资产），并通过结构校验和示例 self-check；当前尚未用它生成 Semantic Codebase 工件 | 支持 39 类品牌化 HTML/SVG/PNG 图表；首次使用必须经过 style-guide gate。它不是 P7 Cognitive Compiler，也不是产品依赖 | [`SKILL.md`](../../../.agents/skills/diagram-design/SKILL.md) |

## 风险、身份与许可证不确定项

| 项目/类别 | 已知风险 | 当前处理 |
| --- | --- | --- |
| GitNexus | 上游及常见 fork 的许可证元数据为 `NOASSERTION`；安装可写 MCP/skills/hooks。 | 禁止复制、分发、链接或在工作仓运行 setup/analyze；许可补齐前只隔离阅读。 |
| Codebase Memory | 名称身份不唯一；安装涉及文件系统、Agent 配置、后台更新/daemon。 | 暂不采用；需用户单独授权和隔离公开仓评估。 |
| Graphify | 许可证历史发生变化；非代码材料可能走模型/API。 | 每次固定提交+LICENSE；私有数据禁止潜在联网路径。 |
| Structurizr | 旧 CLI/Lite/UI 已归档。 | 不把旧工具的活跃性、兼容性或部署许可视为当前保证。 |
| Understand Anything / LocAgent | 含 LLM 或模型调用路径。 | 只借体验/检索思想；私有源码不进入此类路径。 |
| CodeQL / Semgrep / Joern | 二进制、query pack、规则及其许可/运行成本尚未逐次准入。 | 仅未来、版本固定、离线的 Adapter spike；失败/无结果均为 Diagnostic，不冒充事实。 |
| SCIP Python | 依赖 Python、Node、激活环境和包可见性。 | 实验性；调用者需提供审计过的环境，不自动安装依赖。 |
| Benchmark Corpus | Zod 已按冻结 commit/tree 拉取，v3 子集 smoke 已通过，但完整范围尚有 grammar 兼容缺口且未执行上游双冷启动；其余三个真实项目仍未本地克隆。 | 不得声称已完成 Corpus 入库；不得把子集 smoke 冒充完整项目通过。 |
| 本地模型研究 | 用户已决定不维护本地模型；旧候选不能被视为授权。 | 路线使用现有 Codex；重新采用需要明确新授权。 |

## 本地证据导航

| 主题 | 首选本地证据 |
| --- | --- |
| 总体路线、阶段和已决边界 | [`map.md`](../map.md)；尤其 `:13-17,22-52,56-71`。 |
| P0/P1/P2 项目选择 | [`open-source-map-p0-p2.md`](open-source-map-p0-p2.md)；[`extraction-adapters.md`](extraction-adapters.md)；[`graph-precedents.md`](graph-precedents.md)。 |
| P3/P4 项目选择与 Adapter 闸门 | [`open-source-map-p3-p4.md`](open-source-map-p3-p4.md)。 |
| P5/P6/P7 项目选择、许可与隐私边界 | [`open-source-map-p5-p7.md`](open-source-map-p5-p7.md)。 |
| 冻结 Benchmark Corpus、固定提交、许可证和淘汰项目 | [`frozen-benchmark-corpus.md`](frozen-benchmark-corpus.md)。 |
| Benchmark 方法与外部评测研究 | [`benchmark-method-and-corpus.md`](benchmark-method-and-corpus.md)。 |
| 本地 Agent runtime 的历史未采用决定 | [`local-agent-runtime.md`](local-agent-runtime.md) 开头的“未采用”声明；[`map.md`](../map.md) 的 out-of-scope 条目。 |
| 设计票据到研究资产的映射 | [`issues/`](../issues/) 中 `01`–`16`；每张票的 `Answer`/`Disposition` 指向对应研究结论。 |
| V0.1 边界、后续切片和非目标 | [`v01-implementation-handoff.md`](../v01-implementation-handoff.md)；重点 Slice 1 与风险/非目标。 |
| 早期原型历史证据 | [Slice 1 验收收据](../receipts/slice-1-acceptance.md)；必要时从 `.workspace/backups/pre-public-with-references.bundle` 恢复受 Git 跟踪的源码。 |
| 首选真实项目测试语料 | [`references/zod/packages/zod/src/`](../../../references/zod/packages/zod/src/)；版本、排除规则和复放命令见 [`frozen-benchmark-corpus.md`](frozen-benchmark-corpus.md)。 |
| 本地 CodeGraph 一手参考 | [`references/codegraph/README.md`](../../../references/codegraph/README.md)；[`package.json`](../../../references/codegraph/package.json)；[`LICENSE`](../../../references/codegraph/LICENSE)。 |
| 工作区制图工具与既有工件 | [`Archify`](../../../references/codegraph/.agents/skills/archify/SKILL.md)；[`CodeGraph 架构图`](../../../references/codegraph/docs/codegraph-runtime-architecture.html)；[`diagram-design`](../../../.agents/skills/diagram-design/SKILL.md)。 |

## 当前可执行结论

1. 不要把“研究过”写成“已采用”：当前唯一外部解析依赖是 Tree-sitter 三个包；SQLite 是 Node 内置能力上的自有 Store。
2. 当前 Slice 1 只支持 Definition/Evidence；跨文件 Relation、SCIP、MCP、P3–P7 都没有产品实现。
3. CodeGraph 是有价值的本地 MIT 参考、对照和冻结自举语料，但不是可直接嵌入的产品底座。
4. GitNexus、Codebase Memory、Graphify 的许可证/身份/副作用边界，以及任何 LLM/遥测数据路径，都必须在实际引入前重新独立审核。
