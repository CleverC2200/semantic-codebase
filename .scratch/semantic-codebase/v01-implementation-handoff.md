# Semantic Codebase V0.1 实施交接

> 状态：历史交接，已被当前顶层项目边界取代
>
> 本交接对应的 Slice 1 后曾移入 `references/semantic-codebase/`，并于 2026-08-25 从当前工作区退役；必要时可从本地发布前 Git bundle 恢复。新的 Semantic Codebase 从顶层仓库实现，不继续执行本文的旧代码落点和“下一任务”指令。
>
> 目标：让一位主要开发者与 AI Agent 不再重开产品或架构决策，按纵向切片尽快交付一个可体验的 TypeScript/Python Code Intelligence 原型。

## 1. 实施目标

V0.1 只覆盖 P0～P2：把 TypeScript/Python 源码构建为本地、不可变、可追溯的 Structural Graph，并通过同一严格 JSON 契约提供 CLI 与 MCP 查询。

原型成功不等于“分析所有代码语义”。成功定义为：

1. TypeScript 与 Python fixture 都能完成 `index → find definition → traverse → get evidence`。
2. 所有结果绑定 Ready Snapshot，并显示 Freshness、Coverage、Completeness 与 Evidence。
3. 不确定关系成为 Relation Candidate/Diagnostic，绝不写成权威 Relation。
4. 相同输入重复构建结果确定；增量同步与全量重建语义等价。
5. CLI 与 MCP 对相同规范请求返回等价 JSON。
6. 在一个冻结真实开源项目上完成四条人工演示路线。

## 2. 代码落点与技术基线

历史 Slice 1 当时曾归档在（当前已退役）：

```text
references/semantic-codebase/
```

外部 CodeGraph 快照位于：

```text
references/codegraph/
```

上述是历史目录形式；当前仅 CodeGraph 作为本地 Reference 保留，它不是自有产品的源码起点。

默认技术基线：

- Node.js + TypeScript，ESM。
- npm lockfile；不在 V0.1 引入 monorepo 工具。
- Tree-sitter runtime + 固定版本的 TypeScript/Python grammar。
- SQLite 单文件 Store；具体驱动由首次实现以 Node 当前兼容性和可打包性选择，不进入公共 Interface。
- JSON Schema 作为 CLI/MCP 共享契约和 fixture 断言来源。
- Vitest 或 Node 内置 test 二选一；优先复用最少依赖的方案。
- 不部署本地模型，不引入 Web UI、图数据库、向量库、daemon 或 watcher。

建议目录：

```text
references/semantic-codebase/
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── contract/          # Canonical IR、Query、错误、JSON Schema
│   ├── indexing/          # Snapshot build/sync/publish
│   ├── syntax/            # SyntaxAdapter seam 与 TS/Python Adapter
│   ├── resolution/        # 自有确定性 Resolver
│   ├── canonicalization/  # Draft → Canonical IR、冲突和诊断
│   ├── store/             # SQLite GraphStore implementation
│   ├── query/             # 六种只读 Query Interface
│   └── transport/
│       ├── cli/
│       └── mcp/
└── test/
    ├── fixtures/typescript/
    ├── fixtures/python/
    ├── contract/
    └── integration/
```

这是导航结构，不是要求每个目录预先创建。每个切片只创建当时真实需要的 Module。

## 3. 深 Module 与公共 Interface

### Contract Module

唯一职责是定义并规范序列化：Canonical IR、Snapshot、Coverage、Completeness、Evidence、Query Request/Result 与稳定错误。CLI、MCP、测试和 Benchmark 都依赖它，不能各自复制类型或默认值。

### Index Module

对外只提供：

```text
index(IndexRequest) -> IndexReceipt
sync(SyncRequest) -> IndexReceipt
status(StatusRequest) -> StatusResult
```

它隐藏 Manifest 捕获、Adapter 调度、Canonicalizer、GraphStore 写入、验证、原子发布、失败恢复和保留策略。它是唯一 writer。

### SyntaxAdapter seam

```text
extract(SourceFileInput) -> SyntaxSlice
```

首期有两个真实 Adapter：TypeScript Tree-sitter 与 Python Tree-sitter。Adapter 只产出 Draft、Candidate、Evidence、Coverage 和 Diagnostic，不生成最终 Definition Key，不写 Store。

### SemanticEnricher seam

```text
enrich(FrozenRepositoryInput, BaseExtractionView) -> SemanticSlice
```

首期 `core` 不需要外部 Enricher；自有 Resolver 属于 Index Module implementation。`scip-typescript` 是原型通过后的第二个真实 Adapter，不提前建立通用插件框架。

### Query Module

只提供已冻结的六种 Interface：

```text
status(repository)
findDefinitions(scope, filter, budget)
getDefinition(scope, definition_key)
getEvidence(scope, evidence_ids, source_budget)
traverse(scope, seeds, direction, relation_kinds, budget)
findPaths(scope, from, to, relation_kinds, budget)
```

GraphStore、SQL、FTS、CTE/BFS、缓存和源码行列计算都隐藏在实现内。测试和调用者只跨 Query Interface。

### CLI/MCP Adapter

CLI 和 MCP 只做参数/transport 转换，必须调用同一 Contract、Index 和 Query Module。任何一端出现独立默认值、排序、错误解释或自然语言包装，都视为设计漂移。

## 4. 纵向实施切片

每个切片都必须穿过真实公共 Interface，提供可运行命令和验收证据；不按“先写完所有 parser，再写完数据库”横向堆积。

### Slice 1：第一个可查询 Definition

范围：

- 建立最小 Contract Module。
- 实现 TypeScript/Python Tree-sitter SyntaxAdapter。
- 实现完整重建的最小 Index Module 与 SQLite GraphStore。
- 实现 `scb index`、`scb definitions find`、`scb definition get`。
- 两个 fixture 各覆盖 module/class/interface/function/method 的适用子集。

验收：

- 同一 fixture 连续三次索引的规范 JSON 和图 hash 相同。
- Definition Key、name/definition span、content hash、Evidence 可回链源码。
- 语法错误文件只降低 Coverage；Adapter 整体不可用则构建失败。

明确不做：跨文件引用、增量、MCP、SCIP、路径查询。

### Slice 2：可解释的基础结构关系

范围：

- 加入 `CONTAINS`、`IMPORTS`、`EXPORTS`。
- 实现最小确定性 Resolver 和 Relation Candidate。
- 实现 `scb graph traverse` 与 `scb evidence get`。

验收：

- callers/callees 之外的基础依赖可通过显式 direction/kinds 查询。
- 只有唯一端点进入 Relation；冲突/缺失进入 Candidate + Diagnostic。
- 每条 Relation 至少有一份 Evidence。

### Slice 3：跨文件调用与类型关系

范围：

- 加入可确定解析的 `CALLS`、`REFERENCES`、`INHERITS`、`IMPLEMENTS`。
- 补齐 `scb graph paths`。
- 保留动态调用、反射、缺环境和同名冲突边界。

验收：

- fixture 覆盖单跳、多跳、循环、同名冲突和无法判定。
- Traverse/Paths 排序确定，循环安全，预算截断显式。
- 不允许错误权威 Relation；宁可少连，不可错连。

### Slice 4：Snapshot 生命周期与增量等价

范围：

- 实现 source manifest、Snapshot ID、`building → ready|failed|superseded`。
- 实现 `scb sync`、单 writer、原子 current-ready 切换和 Freshness。
- 变化文件重抽取，删除移除，重命名按删除加新增。

验收：

- 增删改 fixture 的增量结果与全量重建规范图一致。
- 失败/过期构建不替换旧 Ready Snapshot。
- `require_fresh=true` 不静默读取 stale Snapshot。

### Slice 5：完整查询契约与预算

范围：

- 六种 Query Interface 全部通过统一 JSON Schema。
- 实现 Coverage、Completeness、预算、稳定错误和 Evidence source budget。
- CLI stdout 只输出单个规范 JSON；stderr 承载进度/诊断。

验收：

- 空结果、截断、Coverage 不足和错误可明确区分。
- 默认/硬上限、确定排序和退出码符合既定契约。
- 不能通过路径参数读取仓库范围外源码。

### Slice 6：MCP 同源 Adapter

范围：

- 实现六个 `semantic_codebase_*` MCP Tool。
- MCP `structuredContent` 与 CLI 规范 JSON 同源。
- `content[].text` 仅承载同一对象的规范 JSON。

验收：

- 同一请求经 CLI/MCP 返回语义等价结果。
- Tool Schema `additionalProperties=false`，未知字段/枚举/版本稳定失败。
- MCP 不获得额外查询能力或隐藏 Scope。

### Slice 7：真实项目演示与 Prototype Gate

范围：

- 选择冻结 CodeGraph 提交做首个真实项目自举演示。
- 完成 Definition 定位、callers、路径、静态证据不足拒答四条路线。
- 保存轻量 Acceptance Receipt。

验收：

- Prototype Gate 六项全部通过。
- 记录索引时间、Store 大小、默认查询时延、Coverage 和 Known Limitation；这些暂为观察值。
- 给用户一个命令即可运行的演示入口和结果说明。

### Slice 8：方向确认后的增强与发布

只有用户认可原型方向后执行：

1. `core+scip-ts` 实验 Adapter，独立报告收益/成本/失败。
2. G1～G3 Release Gate。
3. 64-run Agent Smoke。
4. 根据真实结果决定是否进入 P3 Context Engine。

完整 960-run Evidence Benchmark 不自动运行。

## 5. 每个切片的固定工作方式

每个切片按以下顺序实施：

```text
更新 fixture/期望事实
→ 通过公共 Interface 写失败测试
→ 实现最小行为
→ 运行切片测试和既有回归
→ 运行确定性/规范 JSON 检查
→ 保存 Acceptance Receipt
→ 再进入下一切片
```

实现者不能以内部 class/SQL/AST 快照测试替代公共 Interface 测试。内部测试可以增加，但切片是否完成只由 CLI/Query/MCP 可观察结果决定。

## 6. 已冻结的风险处理

| 风险 | 默认处理 |
| --- | --- |
| Tree-sitter 只有语法、没有完整类型语义 | 未唯一解析的关系成为 Candidate；不猜测。 |
| TypeScript/Python 动态特性 | 显示 Coverage/Diagnostic；不把“未发现”写成“不存在”。 |
| SQLite 查询规模 | 先使用双向索引和有界遍历；真实指标失败后再讨论后端。 |
| 增量逻辑复杂 | 全量重建是语义裁判；增量只是一种等价优化。 |
| SCIP 工具链失败 | `core` 不依赖它；实验 Profile 不允许静默降级。 |
| CLI/MCP 契约漂移 | 同一 Contract Module、序列化器和 golden JSON fixture。 |
| 参考项目诱导复制模型 | CodeGraph/Kythe 仅提供先例；Canonical IR 和 Snapshot 保持自有。 |
| 过早扩范围 | 五种 Definition、七种 Relation、TS/Python、单仓、本地只读是硬边界。 |

## 7. 非目标

- Web UI、IDE 替代品、3D 全局图。
- 全语言、全量数据流、运行时 Trace、自动重构。
- 跨 Snapshot Definition Lineage、跨仓库 Graph。
- Capability、Domain、Workflow、Document、Requirement、Issue/PR/ADR。
- Embedding、LLM Summary、本地模型或自有云服务。
- daemon、watcher、自动修改目标仓库或 Agent 配置。
- 公共 SQL/Cypher、通用 Explore、callers/callees/impact 快捷 Tool。

## 8. 实施开始前检查单

- [x] 领域词汇已在 `CONTEXT.md` 冻结。
- [x] Canonical IR 与 Definition 身份已冻结。
- [x] Snapshot、Freshness、增量和保留策略已冻结。
- [x] SyntaxAdapter/SemanticEnricher seam 已冻结。
- [x] GraphStore 与六种 Query Interface 已冻结。
- [x] CLI/MCP JSON、错误和预算契约已冻结。
- [x] Prototype/Release Gate 已冻结。
- [x] 开源项目借鉴与不照搬边界已记录。
- [x] 冻结 Corpus 与 Agent Smoke 方案已记录。
- [x] 历史上创建并完成 Slice 1；该实现已退役，验收见 [Slice 1 Acceptance Receipt](receipts/slice-1-acceptance.md)。

## 9. 第一个实施动作

以下内容是当时的历史执行说明，当前不再执行。它要求 Slice 1 对 TS/Python fixture 返回稳定、带 Snapshot 和 Evidence 的规范 JSON：

```bash
scb index --repo <fixture> --profile core
scb definitions find --repo <fixture> --snapshot current_ready --require-fresh true --name <name>
scb definition get --repo <fixture> --snapshot current_ready --require-fresh true --definition-key <key>
```

在这三个命令通过之前，不创建 MCP、SCIP、Graph UI、Context Engine 或通用插件系统。
