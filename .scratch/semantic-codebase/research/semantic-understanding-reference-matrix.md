# 从结构索引到源码语义理解：开源技术选型矩阵

日期：2026-09-04

范围：从当前 Structural Graph 继续实现“源码功能理解、可靠调用路径、业务主线、自然语言查询”。
证据原则：只引用项目官方文档、官方仓库、协议和许可证；本地 `references/codegraph/` 只作为冻结参考快照。

## 1. 结论

不应把任何一个外部项目整体复制进 Semantic Codebase。推荐采用三种不同方式：

1. **直接依赖语言事实源**：继续用 Tree-sitter；TypeScript 语义使用 TypeScript Compiler API；Python 语义优先通过 Pyright Type Server 的进程协议取得。
2. **通过 Adapter 导入外部分析结果**：SCIP 可作为多语言符号、引用、实现关系的标准输入；Joern 或 OpenTelemetry 可在后续作为可选的静态数据流与运行时证据源。
3. **仅借鉴设计**：Kythe、CodeQL、Semgrep、CodeGraph 的图模型、查询、Context 输出和评测方法值得借鉴，但不应成为首期权威事实链的硬依赖。

核心边界：Tree-sitter 只给出 CST；编译器/类型检查器补充“这个名字实际指向谁”；CFG/数据流补充“函数内部如何走、值如何传播”；框架模型和运行时 trace 补充静态分析看不到的入口与动态分派；最后才能基于这些证据派生业务主线和自然语言答案。

## 2. 当前能力与目标能力矩阵

状态：`已完成` 表示已有产品代码和查询接口；`部分` 表示已有数据结构或候选但精度/覆盖不足；`未开始` 表示当前权威层没有这类事实。

| 顺序 | 能力模块 | 作用与产物 | 当前状态 | 主要缺口 | 推荐实现方式 | 可借鉴项目 |
|---:|---|---|---|---|---|---|
| 0 | Syntax Facts | 从单文件生成 Definition、源码范围、CONTAINS、关系候选和 Evidence | 已完成 | Tree-sitter 不知道类型、绑定和运行时目标 | 保留自研 `SyntaxAdapter`，继续直接依赖 Tree-sitter | Tree-sitter、CodeGraph extraction |
| 1 | Semantic Symbol Binding | 确定 import/export、标识符、类型、重载、继承和实现的真实目标 | 部分 | 当前 Resolver 主要按路径与名称确定性匹配，无法覆盖别名、类型推断、重载和复杂模块解析 | 自研 `SemanticEnricher` 接口；TS 直接适配 Compiler API，Python 适配 Pyright Type Server；SCIP 可作替代输入 | TypeScript Compiler API、Pyright、SCIP、Kythe |
| 2 | High-fidelity Call Graph | 把每个 call site 绑定到一个或多个可能 callee，并区分 exact/candidate/runtime observed | 部分 | 当前有 CALLS Candidate 和少量已解析边，但动态分派、回调、高阶函数、DI、反射覆盖不足 | 自研统一 CallSite/CallTarget IR；消费编译器/SCIP结果；无法证明的目标保持候选 | CodeQL call graph、Joern、CodeGraph dynamic bridges |
| 3 | Function Behavior IR / CFG | 表达基本块、分支、循环、异常、return/throw/await，回答“函数内部怎样执行” | 未开始 | 现有 Definition 只给函数范围，不描述函数体执行结构 | 自研最小 CFG/Behavior IR；先 TypeScript，必要时用 Joern 对照结果 | Joern CPG/CFG、CodeQL CFG |
| 4 | Data Flow / Effects | 追踪参数、返回值、字段读写、状态变更、IO、数据库、消息等，回答“数据从哪来、到哪去、产生什么副作用” | 未开始 | 没有 SSA/def-use、source/sink、跨过程传递或库函数语义 | 自研 Effect taxonomy 和 Evidence 契约；局部数据流先自己实现或导入 Joern；Semgrep/CodeQL 只作算法与规则参考 | Joern data flow、CodeQL data flow、Semgrep taint |
| 5 | Framework / Entrypoint Semantics | 识别 HTTP route、CLI、队列 consumer、定时任务、事件订阅、测试入口和 DI wiring | 未开始 | 仅靠语言语法看不到多数框架约定和配置装配 | 自研按框架版本化的 `FrameworkEnricher`；所有启发式结果留在派生层或 Candidate | CodeGraph framework synthesizers、Joern overlays |
| 6 | Runtime Trace Correlation | 用真实执行补全反射、动态路由、跨进程调用，并记录“这次运行确实走过” | 未开始 | 静态图无法证明运行时实际路径；单次 trace 又不能证明所有可能路径 | 直接使用 OpenTelemetry SDK/协议采集，自己实现 span → Definition/Evidence 映射 | OpenTelemetry |
| 7 | Application Flow | 从入口沿调用、控制、数据和副作用组成技术主线：入口 → 校验 → 规则 → 状态/外部效果 → 输出 | 未开始 | 当前 `findPaths` 只能在已有关系上找结构路径，不能区分主线、错误分支和副作用 | 自研 Flow Composer；输入是 Call Graph、CFG、Effect、Framework 和 Runtime Evidence | Joern slicing、CodeQL path queries、CodeGraph explore |
| 8 | Capability / Domain Model | 把技术 Flow 归并为稳定业务能力、领域实体、规则和用例；不把目录名直接当业务 | 仅有术语 | 缺少领域词汇、实体/规则识别、代码与文档/测试/配置的证据关联 | 必须自研；允许 LLM 提建议，但人工确认后才形成稳定 Capability；保留 Evidence 和版本 | 无可直接复制项目；可借鉴 CPG overlay 和语义约定思想 |
| 9 | Context Package | 按问题选择最少的定义、路径、源码、配置、测试和不确定性，供人或 Agent 使用 | 仅有术语 | 没有查询规划、证据压缩、排序、token 预算和结果解释 | 自研 Context Engine；借鉴 CodeGraph 单一 explore 工具与紧凑输出，但不复制其事实模型 | CodeGraph context/explore、Joern slicing |
| 10 | Natural-language Query / Summary | 把自然语言拆成结构查询并生成有证据的解释；回答“这个功能怎么实现、影响哪里” | 未开始 | 没有意图解析、query plan、引用校验、答案置信边界 | 自研派生层：NL → typed query plan → Context Package → 本地/受控模型 → evidence validator | CodeGraph explore 交互思路；CodeQL/Joern typed query 思路 |
| 横向 | Semantic Benchmark / Gold | 防止“答案看起来对但边错了”；分别衡量绑定、调用、路径、数据流、业务主线和答案引用 | 结构层已有基线，语义层未开始 | 缺少每层独立 Gold、precision/recall、unknown 分类和真实工程问题集 | 自研冻结 corpus、Gold 和 receipts；外部工具只作交叉验证，不作唯一 Gold | SCIP snapshots、Joern/CodeQL query fixtures、CodeGraph benchmark methodology |

### 2.1 推荐开发顺序

```text
现有 Syntax / Evidence / Snapshot / Query 基座
  → TypeScript Semantic Enricher（符号、类型、模块、实现关系）
  → 精确 CallSite / CallTarget 图
  → 函数级 CFG / Behavior IR
  → 局部 Data Flow + Effect Summary
  → Framework / Entrypoint Enricher
  → Application Flow Composer
  → OpenTelemetry 运行时证据关联（可与 Flow Composer 后半段并行）
  → Capability / Domain Model
  → Context Package
  → 自然语言查询与证据化摘要
```

Benchmark 不是最后一步；每新增一层都同时建立该层的 Gold 和误差分类。

首个可交付纵切建议只支持 TypeScript：选一个 HTTP/CLI 入口，证明“入口 → 2~5 层调用 → 一个业务判断 → 一个副作用 → 返回值”的完整链路。先不要同时扩 Python、Embedding 和 UI。

## 3. 项目选型：直接依赖、适配导入还是仅借鉴

| 项目 | 官方能力 | 对本项目最有价值的部分 | 推荐方式 | 不应误认为 | 许可证/集成风险 |
|---|---|---|---|---|---|
| [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) | 增量解析并生成源码 CST，编辑时可高效更新 | 多语言、容错、稳定源码范围；当前 Syntax Adapter 的正确底座 | **继续直接依赖** | 它不负责模块解析、类型检查、调用目标、CFG、数据流或业务语义 | MIT；不同 grammar 仍需分别固定版本和测试。官方说明产物是 CST，不是仓库级语义图。[许可证](https://github.com/tree-sitter/tree-sitter/blob/master/LICENSE) |
| [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) | `Program`、`SourceFile`、binder/type checker、language service | TS/JS 的真实模块解析、Symbol、Type、Signature、实现/引用与重载决议 | **首选直接依赖，通过自研 TS SemanticEnricher 包住** | 它不会自动提供本项目 Canonical IR、业务主线或通用多语言模型 | Apache-2.0；Compiler API 与 TS 版本耦合，官方 Wiki 明示 API 可能破坏性变化，因此必须锁版本、做 corpus parity。[仓库](https://github.com/microsoft/TypeScript) |
| [ts-morph](https://ts-morph.com/) | TypeScript Compiler API 的对象封装，简化 AST 导航、引用和修改 | 降低 PoC 代码量；可快速验证 TypeChecker、resolved signature 和 reference API | **可选直接依赖；先做小型 A/B，再决定是否采用** | 它不是另一套更强的语义引擎，底层仍是 TypeScript Compiler API | MIT；多一层对象缓存和版本适配，且底层 compiler object 在修改后会失效。当前项目只读分析不一定需要其 mutation 抽象。[Type Checker 文档](https://ts-morph.com/navigation/type-checker) [许可证](https://github.com/dsherret/ts-morph/blob/latest/LICENSE) |
| [Pyright](https://github.com/microsoft/pyright) / [Type Server](https://github.com/microsoft/pyright/blob/main/docs/type-server.md) | Python 静态类型检查、import resolution、类型推断；Type Server 通过 JSON-RPC 暴露 computed/declared/expected type 和 import resolution | Python Semantic Enricher 的语言事实源 | **通过 stdio Type Server 适配导入**，不要直接耦合 `pyright-internal` | 它主要给类型/绑定事实，不直接给业务主线、完整跨过程调用图和副作用 | MIT；常驻子进程、文档同步、snapshot version 和 Python 环境解析需要治理。使用公开 Type Server 协议比 import 内部包更稳。[许可证](https://github.com/microsoft/pyright/blob/main/LICENSE.txt) |
| [SCIP](https://github.com/scip-code/scip) / [scip-typescript](https://github.com/sourcegraph/scip-typescript) | 语言无关的代码导航索引：Occurrence、SymbolInformation、定义/引用/实现/类型定义、enclosing range；TS/JS 有官方 indexer | 快速获得编译器级 symbol/occurrence/reference/implementation；为以后多语言统一输入提供协议 | **做可选 SCIP Import Adapter**；TS 首期仍优先 Compiler API 以保留控制力 | SCIP 不是 AST/CFG/数据流格式；不能仅凭 SCIP 宣称完整 call graph 或业务行为 | SCIP、scip-typescript 为 Apache-2.0。SCIP 源范围对 JS/TS通常使用 UTF-16 行内偏移，而当前 Canonical IR 使用 UTF-8 byte span，必须做严格映射。官方 schema 允许从精确编译器索引到语法启发式索引，导入时必须记录 producer/profile，不能一概视为同等权威。[协议](https://github.com/scip-code/scip/blob/main/scip.proto) |
| [Kythe](https://kythe.io/docs/schema-overview.html) | 跨语言语义图：anchor、definition/reference、call、extends、overrides、typed 等统一 schema | Anchor/Evidence 分离、稳定 VName、丰富 edge taxonomy、反向边派生 | **仅借鉴 schema 与身份设计；后期再评估 import** | 它不是轻量 npm 库，也不会替本项目自动生成业务语义 | Apache-2.0；完整生态涉及 indexer、Bazel/serving pipeline 和自己的身份/存储约定，与当前轻量 SQLite Canonical IR 重叠较大。[Schema](https://kythe.io/docs/schema/) [许可证](https://github.com/kythe/kythe/blob/master/LICENSE) |
| [Joern](https://docs.joern.io/code-property-graph/) | CPG 把 AST、CFG、调用、控制和数据流放入可扩展 property graph；支持 slicing 和自定义外部函数语义 | Behavior/CFG/DataFlow/overlay/query 的成熟参考，也可作为离线对照分析器 | **先仅借鉴；P4 可做可选外部 Enricher PoC** | 它不是业务理解器；CPG 路径仍需要 source/sink、framework semantics 和领域映射 | Apache-2.0；Scala/JVM、独立 CPG 存储和语言 frontend 使部署/资源成本显著增加。官方也说明外部函数若缺语义模型会产生保守但不精确的数据流。[Data-flow semantics](https://docs.joern.io/dataflow-semantics/) [许可证仓库](https://github.com/joernio/joern) |
| [Semgrep Community Edition](https://github.com/semgrep/semgrep) | 多语言结构模式、常量传播、类型辅助匹配、规则式 taint | 快速定义框架入口、source/sink/sanitizer 和业务禁用模式；可作为 Diagnostic/Effect 提示源 | **可选命令行 Adapter 或仅借鉴 rule DSL**，不进入首期核心事实链 | OSS 版不是完整跨文件/跨过程通用数据流；官方文档明确 interfile 分析属于 proprietary engine | OSS engine 为 LGPL-2.1；分发、链接和修改需法务确认。官方规则还有单独 Rules License，不能默认复制规则库。[能力边界](https://semgrep.dev/docs/writing-rules/glossary) [规则许可](https://semgrep.dev/legal/rules-license/) |
| [CodeQL](https://codeql.github.com/docs/codeql-overview/about-codeql/) | 可查询代码数据库，包含 AST、CFG、data-flow graph；库提供 call graph、局部/全局 data flow 和 path query | 学习 AST/CFG/DFG 分层、SSA、call precision/completeness 标记、path query 与 library models | **仅借鉴模型与测试；除非获得明确许可，不作为产品运行时** | `github/codeql` 查询库开源不等于 CodeQL CLI/engine 可自由用于任意私有项目或商业产品 | 查询库 MIT，但 CLI/engine 单独受 CodeQL 条款限制；官方条款对闭源代码和自动化/CI用途有限制，商用需单独授权。[仓库说明](https://github.com/github/codeql) [CLI 条款](https://github.com/github/codeql-cli-binaries/blob/main/LICENSE.md) |
| [OpenTelemetry](https://opentelemetry.io/docs/concepts/signals/) | 标准化采集 traces/metrics/logs；trace 由 parent/child spans 表示请求端到端旅程 | 补全动态分派、跨服务路径和真实副作用；把运行时 span 关联到 Snapshot/Definition | **后期直接依赖 SDK/OTLP；自研 Correlator Adapter** | Trace 只证明被观测的运行，不证明未执行路径不存在，也不能代替静态图 | Apache-2.0；需要显式 instrumentation、采样与源码版本关联；trace 可能包含参数/用户数据，必须默认脱敏并保持本地边界。[Tracing 概念](https://opentelemetry.io/docs/concepts/observability-primer/) [JS 许可证](https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE) |
| 本地 [CodeGraph](../../../references/codegraph/README.md) | Tree-sitter 多语言抽取、SQLite/FTS5、跨文件 resolution、框架/动态桥接、watcher、MCP `explore` 和 context 输出 | SQLite 工程、增量收敛、framework synthesizer、provenance 标签、单工具 Context UX、benchmark 隔离 | **仅作为工程参考与对标，不作为运行时依赖或事实来源** | README 的“semantic”主要是结构关系、启发式桥接和上下文检索，不等于编译器级完整语义或业务理解 | 本地快照 `1.5.0`、MIT。其可变图、启发式正式边、daemon/MCP耦合与当前 Snapshot/Evidence/authority 设计不同；可借鉴实现模式，不能直接兼容 schema。[许可证](../../../references/codegraph/LICENSE) |

## 4. 自己写什么，直接用什么

| 类别 | 建议 |
|---|---|
| 直接使用成熟项目 | Tree-sitter runtime/grammar；TypeScript Compiler API；Pyright Type Server；后期 OpenTelemetry SDK/OTLP |
| 自己实现 Adapter | TypeScript/Pyright/SCIP/Joern/OpenTelemetry 到 Canonical IR、Evidence、Coverage、Diagnostic 的转换；offset 映射；版本和 producer profile |
| 自己实现核心产品 | Canonical Semantic IR、CallSite/CallTarget 模型、Effect taxonomy、Framework Enricher 契约、Application Flow、Capability、Context Package、NL query plan、Evidence validator、Benchmark Gold |
| 只借鉴不复制 | Kythe identity/edge schema；Joern CPG/overlay/slicing；CodeQL CFG/DFG/path/精度标记；Semgrep rule DSL；CodeGraph SQLite/FTS/context/MCP/benchmark 工程 |

原因是：外部工具最可靠的是“语言或运行时事实”，而 Semantic Codebase 的产品差异在于统一 Evidence、Snapshot 权威边界、能力/业务主线模型和给 Agent 的 Context Package。这些产品契约没有现成项目能直接替代。

## 5. 推荐的具体落地切片

### Slice A：TypeScript 语义绑定

- 新增窄接口：`enrich(FrozenRepository, ReadySyntaxSnapshot) -> SemanticSlice`。
- 使用 TypeScript `Program` + `TypeChecker` 解析 tsconfig、path aliases、Symbol、Type、Signature、import/export、implements/override。
- 所有结果携带 TypeScript version、tsconfig digest、源文件 digest 和 UTF-8 Evidence span。
- 与当前 Resolver 并行跑，比较 resolved/unresolved 差异；先不替换 Ready Snapshot。
- Gold：Zod 中选择 alias import、re-export、method call、overload、interface implementation 样本。

### Slice B：Call Graph

- 显式建模 `CallSite`，而不是只保留 Definition → Definition 的压缩边。
- 每个目标记录 `exact | possible | observed`、derivation、Evidence。
- exact 关系进入权威层；possible 留 Candidate；observed 留运行时派生层。
- 验收分别计算 call-site target precision、recall、zero-target 和 multi-target 数量。

### Slice C：Behavior + Effect

- 先做函数内基本块、branch/return/throw/await；暂不做全语言完整 SSA。
- 首批 Effect 只定义 `READ_STATE`、`WRITE_STATE`、`IO_CALL`、`EMIT_EVENT`、`THROW`、`RETURN`。
- 对外部库调用采用版本化 library model；无模型时明确 unknown，不把所有调用猜成副作用。

### Slice D：Application Flow 与 Context

- 先支持一个入口类型，例如 Express route 或 CLI command。
- Flow 不是“最长调用链”，而是带角色的路径：entry → validate → decide → mutate/effect → respond。
- Context Package 只取支持该 Flow 的定义、源码、测试、配置和未解析缺口。
- 自然语言层只能查询与压缩，不得创造 Canonical Relation。

## 6. 风险与硬边界

1. **不可混淆精度等级**：compiler-exact、static-possible、framework-heuristic、runtime-observed、LLM-inferred 必须分层保存。
2. **不可把外部输出直接写权威表**：都先进入 Semantic Enricher 的 staging slice，经 Canonicalizer 校验后再发布。
3. **不可忽略 offset 编码**：Tree-sitter/当前 IR 用 UTF-8 byte；TypeScript/SCIP 常出现 UTF-16 位置；必须以源码 bytes 做可逆映射和 emoji/中文 Gold。
4. **不可把单次运行当完整行为**：OpenTelemetry 只补“发生过”的边，不否定静态可能路径。
5. **不可先做 LLM 摘要**：调用和数据流仍大量 unresolved 时，摘要只会把结构缺口包装成确定叙述。
6. **许可必须按组件核对**：尤其 Semgrep engine/规则、CodeQL library/CLI 不是同一许可；不得因仓库公开就假定可嵌入商业产品。
7. **业务主线没有通用现成答案**：框架入口可以规则化，业务能力仍需要领域词汇、文档、测试和人工确认；LLM 只能生成有 Evidence 的候选。

## 7. 一手来源索引

- Tree-sitter：[Introduction](https://tree-sitter.github.io/tree-sitter/)；[Grammar / CST](https://tree-sitter.github.io/tree-sitter/creating-parsers/3-writing-the-grammar.html)；[MIT License](https://github.com/tree-sitter/tree-sitter/blob/master/LICENSE)
- TypeScript：[Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)；[Repository / Apache-2.0](https://github.com/microsoft/TypeScript)
- ts-morph：[Purpose](https://ts-morph.com/)；[Type Checker](https://ts-morph.com/navigation/type-checker)；[MIT License](https://github.com/dsherret/ts-morph/blob/latest/LICENSE)
- Pyright：[Repository](https://github.com/microsoft/pyright)；[Type Server Protocol](https://github.com/microsoft/pyright/blob/main/docs/type-server.md)；[MIT License](https://github.com/microsoft/pyright/blob/main/LICENSE.txt)
- SCIP：[Protocol repository](https://github.com/scip-code/scip)；[Schema](https://github.com/scip-code/scip/blob/main/scip.proto)；[scip-typescript](https://github.com/sourcegraph/scip-typescript)
- Kythe：[Schema Overview](https://kythe.io/docs/schema-overview.html)；[Schema Reference](https://kythe.io/docs/schema/)；[Apache-2.0](https://github.com/kythe/kythe/blob/master/LICENSE)
- Joern：[Code Property Graph](https://docs.joern.io/code-property-graph/)；[Control Flow](https://docs.joern.io/cpgql/control-flow-steps/)；[Data Flow](https://docs.joern.io/cpgql/data-flow-steps/)；[Slicing](https://docs.joern.io/cpg-slicing/)；[Repository / Apache-2.0](https://github.com/joernio/joern)
- Semgrep：[Community Edition repository](https://github.com/semgrep/semgrep)；[Static-analysis glossary and OSS/Pro boundary](https://semgrep.dev/docs/writing-rules/glossary)；[Rules License](https://semgrep.dev/legal/rules-license/)
- CodeQL：[Database model](https://codeql.github.com/docs/codeql-overview/about-codeql/)；[Data flow](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/)；[JS/TS call graph](https://codeql.github.com/docs/codeql-language-guides/codeql-library-for-javascript/)；[CLI license](https://github.com/github/codeql-cli-binaries/blob/main/LICENSE.md)
- OpenTelemetry：[Signals](https://opentelemetry.io/docs/concepts/signals/)；[Spans and traces](https://opentelemetry.io/docs/concepts/observability-primer/)；[JS Apache-2.0](https://github.com/open-telemetry/opentelemetry-js/blob/main/LICENSE)
- CodeGraph：本地 `references/codegraph/README.md`、`references/codegraph/LICENSE`、`references/codegraph/src/`。
