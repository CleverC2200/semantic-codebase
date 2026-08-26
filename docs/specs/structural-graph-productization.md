# Structural Graph Productization Spec

状态：Accepted

版本：0.2

适用阶段：P2 Structural Code Graph 产品化

依赖：[Syntax Extraction Spec](syntax-extraction.md)

领域词汇：[CONTEXT.md](../../CONTEXT.md)

## 1. 决策摘要

Semantic Codebase 继续以不可变 Snapshot、Evidence 和确定性 Relation 为权威事实内核，选择性吸收 CodeGraph 的 SQLite、FTS5、增量收敛、运行状态和 Agent 集成经验，不复制其可变身份、启发式正式边或 MCP 与事实层的深耦合。

实施顺序固定为：

```text
关系语义修复
→ Snapshot Store
→ Query Module
→ CLI
→ MCP
→ Freshness 自动化与性能优化
```

任何后续能力都不得绕过 Canonicalizer 或降低 Ready Snapshot 的事实要求。若一个结果只能通过 confidence、目录距离、模糊名称或框架猜测得到，它必须保留为 Relation Candidate、Diagnostic 或非权威派生视图，不能进入 Structural Graph。

## 2. 当前基线

当前顶层实现已经具备：

- TypeScript、Python Syntax Adapter；
- Definition、Relation Candidate、Evidence、Diagnostic 与 Coverage；
- 确定性 Resolver；
- Canonicalizer 与 Ready Graph；
- 变化文件完整重抽取、未变化文件复用及增量/全量 parity；
- Zod v3 冻结语料生成物。

当前仍缺少：

- 仓库文件发现与 Manifest 捕获；
- 持久化 Store、Snapshot 生命周期与原子 Ready 指针；
- Definition、Evidence、遍历和路径查询；
- CLI 与 MCP Adapter；
- 显式 Freshness 检查；
- watcher、daemon 和大仓并行优化。

本次对标审计确认三个必须先修的事实问题：

1. `EXPORTS` 的来源归属错误，可产生 Definition 到自身的无意义自环；当前 Zod v3 生成物中存在 132 条此类边。
2. Canonicalizer 只检查 `candidate_local_id` 是否存在，尚未完整证明 Resolution 的 kind、source、Evidence 与原 Candidate 一致。
3. Import binding 只按目标文件同名 Definition 匹配，尚未验证该 Definition 是否从目标模块导出。

在以上问题关闭前，当前 `ready` 只能表示结构、范围、Evidence 和版本校验通过，不能作为关系语义已经正确的发布承诺。

## 3. 目标与成功标准

### 3.1 目标

交付一个本地、只读、可复核的 TypeScript/Python Structural Graph，使人和 Agent 能够：

1. 显式索引一个 Repository；
2. 查询 Definition 及其 Evidence；
3. 按指定 Relation kind 和方向执行有界遍历；
4. 查找两个 Definition 之间的有界路径；
5. 明确区分未找到、未解析、Coverage 不足、结果截断和 Snapshot 陈旧；
6. 通过 CLI 与 MCP 获得语义等价的规范结果。

### 3.2 成功标准

V0.2 Prototype Gate 同时满足以下条件才算完成：

- 支持范围内的 Fixture 不产生已知错误权威 Relation；
- 禁止的自环为零，合法递归调用仍可表达；
- Canonicalizer 无法接受与 Candidate 不一致的伪 Resolution；
- Import/Export 只在导出绑定可证明时提升；
- SQLite 读回的 Canonical Graph 与写入前 graph hash 一致；
- 失败构建不替换旧 Ready Snapshot；
- 增量结果与全量重建的规范图一致；
- 六种 Query Interface 的排序、预算和截断确定；
- CLI/MCP 对同一请求返回语义等价的 Query Result；
- Zod v3 smoke 可通过 CLI 生成、查询和回链 Evidence；
- 源码不离开本机，不写回目标 Repository，不读取 Scope 外文件。

## 4. 范围

### 4.1 V0.2 范围

- 语言：TypeScript、Python。
- Definition：`module`、`class`、`interface`、`function`、`method`。
- Relation：`CONTAINS`、`IMPORTS`、`EXPORTS`、`CALLS`、`INHERITS`、`IMPLEMENTS`、`REFERENCES`。
- 单 Repository、不可变 Snapshot、本地 SQLite。
- 显式 `index`、`sync`、`status`。
- 六种精确 Query Interface。
- CLI 与 MCP Transport Adapter。
- Zod v3 真实项目 smoke。

### 4.2 非目标

- 编译器级类型检查、重载决议、反射、运行时调用图；
- confidence/fuzzy 关系自动升级；
- Web UI、图数据库、向量检索、Embedding 或 LLM Summary；
- 跨 Repository Graph、跨 Snapshot Definition Lineage；
- 通用 SQL、Cypher 或无界图查询；
- Rust kernel、WASM/native 双实现；
- 自动修改目标 Repository 或 Agent 配置；
- 默认常驻 watcher/daemon；
- 自然语言 `explore` 作为权威 Query Interface。

## 5. 权威事实与派生视图

系统分成两个语义层级：

### 5.1 权威层

权威层只包含：

- Ready Snapshot；
- Canonical Definition；
- 经过语义不变量验证的 Canonical Relation；
- Evidence、Coverage、Diagnostic；
- 未提升的 Relation Candidate。

Query Module、CLI、MCP 和后续 Context Engine 只能读取该层，不能直接新增或改写权威事实。

### 5.2 派生层

以下内容若未来实现，只能属于派生层：

- confidence、fuzzy、路径距离或框架启发式候选；
- “可能的影响范围”；
- 自然语言查询规划；
- Context Package、摘要和排序；
- runtime trace 或外部工具建议。

派生结果必须携带来源、算法版本和权威 Snapshot ID；不得序列化为 Canonical Relation，也不得改变 Ready 状态。

## 6. 模块与 Seam

```text
Repository path
      │
      ▼
┌───────────────────────────────┐
│ Index Module                  │
│ index / sync / status         │
│                               │
│ Manifest capture              │
│ → Syntax Adapter              │
│ → Resolver                    │
│ → Canonicalizer               │
│ → semantic invariants         │
│ → atomic publish              │
└───────────────────────────────┘
      │ Ready Snapshot
      ▼
┌───────────────────────────────┐
│ Store Module                  │
│ SQLite / FTS5 / transactions  │
└───────────────────────────────┘
      │
      ▼
┌───────────────────────────────┐
│ Query Module                  │
│ exact lookup / traverse/path  │
└───────────────────────────────┘
      │
      ├──────────────► CLI Adapter
      └──────────────► MCP Adapter
```

### 6.1 Index Module

公共 Interface：

```text
index(IndexRequest) -> IndexReceipt
sync(SyncRequest) -> IndexReceipt
status(StatusRequest) -> StatusResult
```

Index Module 是唯一 writer，隐藏文件发现、Manifest、Adapter 调度、Resolver、Canonicalizer、语义不变量、Store 事务、原子发布和失败恢复。

调用者不能提交 Canonical Definition/Relation，不能直接切换 Ready 指针，也不能选择跳过某个验证阶段。

### 6.2 Syntax Adapter

沿用 Syntax Extraction Spec：

```text
extract(SourceFileInput) -> SyntaxSlice
```

它保持逐文件、只读、确定性，不写 Store，不生成最终 Canonical Key。

### 6.3 Resolver

Resolver 只读取冻结 Repository View，并返回：

```ts
interface ResolvedRelationDraft {
  candidate_local_id: string;
  target: ResolvedEndpoint;
  derivation: string[];
}
```

`kind`、`source` 和 `evidence_local_ids` 不再由 Resolver 重复提交。Canonicalizer 必须根据 `candidate_local_id` 从原 Candidate 重新取得这些字段，从结构上消除两份数据漂移。

Resolver 只能返回唯一 target；零个或多个合法 target 均保持 unresolved。

### 6.4 Canonicalizer

Canonicalizer 仍是进入 Canonical IR 的唯一入口，并新增关系语义验证：

- Candidate/Resolution 一一绑定；
- endpoint kind 符合 Relation 矩阵；
- source/target 属于同一 Snapshot；
- Evidence 完整且属于原 Candidate；
- derivation 使用已注册的确定性规则；
- 不存在该 Relation kind 禁止的自环；
- Import/Export visibility 可证明；
- 冲突或非法关系进入 Diagnostic，不进入 Structural Graph。

### 6.5 Store Module

V0.2 只实现 SQLite，不建立可插拔 Store Adapter 体系。SQLite driver、表结构、FTS5、事务、WAL、索引和 migration 都属于 Store Module Implementation。

Store Module 的调用者只有 Index Module 与 Query Module；Transport 不得直接访问 SQL。

### 6.6 Query Module

公共 Interface 固定为：

```text
status(repository)
findDefinitions(scope, filter, budget)
getDefinition(scope, definition_key)
getEvidence(scope, evidence_ids, source_budget)
traverse(scope, seeds, direction, relation_kinds, budget)
findPaths(scope, from, to, relation_kinds, budget)
```

`callers`、`callees`、`dependencies` 和 `impact` 不增加独立 Interface：

- callers：`traverse(direction=in, relation_kinds=[CALLS], max_depth=1)`；
- callees：`traverse(direction=out, relation_kinds=[CALLS], max_depth=1)`；
- 结构影响：调用者显式指定方向、Relation kinds 和深度；
- dependencies：调用者显式选择 `IMPORTS`、`REFERENCES` 或其他关系。

### 6.7 CLI/MCP Adapter

CLI 与 MCP 只转换 Transport，必须共用 Contract、Query Module、默认值、排序、错误码和规范序列化器。

V0.2 权威 MCP Interface 保持六个精确 Tool，不引入 CodeGraph 风格的自然语言单一 `explore`：

```text
semantic_codebase_status
semantic_codebase_find_definitions
semantic_codebase_get_definition
semantic_codebase_get_evidence
semantic_codebase_traverse
semantic_codebase_find_paths
```

单一 `explore` 只能在后续 P3 作为 Query Module 之上的版本化 Context Recipe，并在 Agent Benchmark 证明收益且没有语义漂移后启用。

## 7. Relation 语义不变量

### 7.1 Endpoint 矩阵

| Relation | 合法 source | 合法 target | 自环 |
| --- | --- | --- | --- |
| `CONTAINS` | SourceFile、module/class/interface Definition | Definition | 禁止 |
| `IMPORTS` | SourceFile、module Definition | SourceFile、已导出 Definition | 禁止 |
| `EXPORTS` | SourceFile、module Definition | Definition、re-export SourceFile | 禁止 |
| `CALLS` | SourceFile、function/method Definition | function/method/class Definition | 允许可证明的递归调用 |
| `INHERITS` | class/interface Definition | class/interface Definition | 禁止 |
| `IMPLEMENTS` | class Definition | interface Definition | 禁止 |
| `REFERENCES` | SourceFile、Definition | Definition | 允许可证明的自引用 |

不在矩阵中的 endpoint 组合必须产生稳定 Diagnostic，并阻止该 Relation 发布。

### 7.2 `EXPORTS` 语义

- `export class C {}`：SourceFile 或直接包含它的 module Definition `EXPORTS` `C`。
- `export { C }`：SourceFile/module `EXPORTS` 已唯一解析的 `C`。
- `export { C as D } from "./m"`：当前 Snapshot 只连接到原 Definition `C`；alias `D` 保留在 Evidence/导出绑定中，不创建伪 Definition。
- `export * from "./m"`：如果模块路径唯一，可建立到目标 SourceFile 的 re-export Relation；具体 Definition 只有在其导出绑定可枚举且唯一时才展开。
- 默认导出匿名表达式若没有稳定 Definition，不创建 Definition；保留 Candidate/Diagnostic。
- `EXPORTS` 的 source 不得取当前被导出 Definition 本身。

### 7.3 Import/Export visibility

Resolver 必须先从语法 Candidate 构建每个 SourceFile/module 的导出绑定表，再解析 import binding：

```text
exported name
→ local Definition 或 re-export target
→ alias / default / wildcard metadata
→ Evidence
```

`import { x } from "./m"` 只有在 `m` 的导出绑定表中唯一存在 `x` 时才解析到 Definition。目标文件中存在一个未导出的同名 Definition 不构成合法 target。

Default、namespace、alias、re-export chain 和循环依赖必须各有独立 Fixture；无法证明时保持 unresolved。

### 7.4 Candidate/Resolution binding

Canonicalizer 必须按 `candidate_local_id` 重新取得 Candidate，并验证：

- Candidate 属于当前 Repository View；
- Candidate kind 与 Adapter capability 一致；
- source 由 Candidate 唯一决定；
- Evidence ID 集合与 Candidate 一致；
- target 属于当前 Snapshot；
- derivation 中每个规则已注册且适用于该 Candidate；
- 同一 Candidate 最多发布一个 Relation。

伪造 candidate ID、替换 source/kind/Evidence、跨 Snapshot target 或重复 Resolution 均为硬失败测试场景。

## 8. Snapshot Store

### 8.1 逻辑数据集

SQLite 至少持久化：

```text
repositories
snapshots
source_files
adapter_manifests
definitions
relations
evidence
relation_candidates
diagnostics
snapshot_coverage
repository_ready_pointer
schema_migrations
```

Canonical JSON 可作为验收和导出格式，但不能作为查询时的唯一存储结构。

### 8.2 身份与不可变性

Snapshot ID 由以下输入确定：

```text
repository_id
+ source_manifest_digest
+ canonical_ir_version
+ adapter_profile_digest
+ index_config_digest
```

Ready Snapshot 发布后不可原地修改。任何源码、grammar、Query、Adapter config、Canonical IR 或索引配置变化都生成新 Snapshot。

Definition、Relation 和 Evidence 行必须包含 `snapshot_id`；禁止只依赖全局可变 Node ID。

### 8.3 原子发布

状态机：

```text
building -> ready | failed | superseded
```

发布顺序：

```text
捕获冻结 Manifest
→ 构建新 Snapshot
→ 语义验证
→ 持久化完整数据
→ Store 完整性检查
→ 再次核对 observed Manifest
→ 单事务切换 current_ready
```

失败、超时、进程终止或源码二次变化不得破坏旧 Ready Snapshot。

### 8.4 查询索引

首期至少提供：

- Definition：`snapshot_id + definition_key` 唯一索引；
- Definition name、qualified name、file path、kind 索引；
- Definition name/qualified name 的 FTS5；
- Relation：`snapshot_id + source + kind`、`snapshot_id + target + kind`；
- Relation identity 唯一约束；
- Evidence：`snapshot_id + evidence_id`；
- Candidate：snapshot、file、kind、resolution status 索引。

FTS 只负责候选检索和排序，不参与 Definition/Relation 身份或关系提升。

## 9. Query Contract

### 9.1 Query Scope

每次查询必须显式提供：

```text
repository_id
snapshot = explicit_id | current_ready
require_fresh
```

`current_ready` 在查询开始时原子解析为一个 Snapshot ID；同一查询不能跨 Snapshot 读取。

### 9.2 Query Result

所有成功结果统一返回：

```text
QueryResult<T>
├── schema_version
├── snapshot
│   ├── repository_id
│   ├── snapshot_id
│   ├── revision
│   └── freshness
├── data
├── completeness
│   ├── complete
│   ├── truncated
│   ├── reason
│   └── budget_used
├── coverage
└── evidence_refs
```

空结果只表示“该 Snapshot 的已索引数据中未找到”。只有 `completeness.complete=true` 且 Coverage 充分时，调用者才可做更强判断，但仍不能推导动态代码中绝对不存在。

### 9.3 Query Budget

默认值/硬上限：

```text
max_depth       3 / 8
max_nodes     500 / 5000
max_results    50 / 500
max_paths      20 / 100
timeout_ms   2000 / 10000
source_bytes 16KB / 128KB
```

触达预算必须返回 `truncated=true` 和首先触发的原因，不能把部分结果伪装成完整结果。

### 9.4 确定排序

- Definition：精确 qualified name、精确 name、前缀、FTS 分数、Definition Key；
- Traverse：BFS 最短深度，再按 Relation kind、Relation Key；
- Paths：最短跳数，再按 Relation Key 序列；
- Evidence：file path、start byte、Evidence ID。

遍历全局去重 Definition；单条 Path 不允许节点重复。

## 10. CLI 与 MCP 契约

### 10.1 CLI

```text
scb index
scb sync
scb status
scb definitions find
scb definition get
scb evidence get
scb graph traverse
scb graph paths
```

- stdout 只输出一个规范 JSON 对象；
- 进度和人类诊断写 stderr；
- `--repo` 必须显式给出；
- 退出码：成功 `0`，参数/Schema `2`，Scope/Snapshot/Freshness `3`，内部失败 `4`。

### 10.2 MCP

- `structuredContent` 是权威对象；
- `content[].text` 只能承载同一对象的规范 JSON；
- Schema 使用 `additionalProperties: false`；
- MCP 不得隐式 index、sync、修改 Agent 配置或启动 watcher；
- MCP 没有 CLI 之外的事实能力。

### 10.3 稳定错误

至少包含：

```text
INVALID_ARGUMENT
REPOSITORY_NOT_FOUND
SNAPSHOT_NOT_FOUND
NO_READY_SNAPSHOT
SNAPSHOT_NOT_READY
STALE_SNAPSHOT
INDEX_BUILD_FAILED
STORE_INTEGRITY_ERROR
INTERNAL_QUERY_ERROR
```

## 11. 增量与 Freshness

### 11.1 增量规则

- 未变化文件只有在 source digest、byte length、language 和 Adapter Profile 都一致时复用；
- 变化文件完整重抽取；
- 删除从新 Snapshot 移除；
- 重命名按删除加新增处理；
- 受影响的 import/export binding、Relation Candidate 和 Resolution 必须重新计算；
- 全量重建始终是语义裁判。

如果无法证明增量结果与全量等价，必须放弃增量产物并执行全量重建，不能发布“部分更新的 Ready Snapshot”。

### 11.2 Freshness

Freshness 比较 Ready Snapshot 的 indexed Manifest 与当前 observed Manifest：

```text
fresh | stale | unknown
```

stale/unknown 响应必须包含原因和两个 Manifest 摘要。`require_fresh=true` 时显式失败。

V0.2 先提供查询前按需检查和显式 `sync`。watcher、daemon、catch-up gate 和 stale banner 只有在真实使用证明需要后才进入后续阶段。

## 12. CodeGraph 采用边界

### 12.1 可直接借鉴

- SQLite + FTS5 技术路线；
- source/target + kind 的双向关系索引；
- Relation identity 唯一约束；
- unresolved reference 生命周期；
- 增量结果与全量重建完整边集合收敛测试；
- Store migration、WAL、锁和失败恢复经验；
- stale/degraded 状态对用户和 Agent 可见；
- 有真实大仓性能证据后再采用 parse/resolver worker。

### 12.2 禁止照搬

- `file_path + kind + name + line` 形式的全局可变 Node ID；
- 没有 Snapshot/Evidence 绑定的 Edge；
- confidence、fuzzy 或路径接近度结果直接写正式 Relation；
- `INSERT OR REPLACE` 修改已发布事实；
- MCP 直接打开、修改或定义 Store 语义；
- watcher 失败后静默声称索引仍然 fresh；
- 为语言和框架特判提前建立超大统一 Resolver。

## 13. 实施切片

### Slice A：关系语义修复

范围：

- 修复 `EXPORTS` source；
- 简化 `ResolvedRelationDraft`；
- 强绑定 Candidate/Resolution；
- 构建 export binding；
- 加入 endpoint/self-edge 语义矩阵；
- 扩充 Fixture 和 Zod 关系审计。

验收：

- Zod v3 禁止自环为零；
- 合法递归 CALLS 保留；
- private import 不解析；
- alias/default/wildcard/re-export Fixture 通过；
- 伪造 Resolution 被 Canonicalizer 拒绝；
- 现有 25 个测试继续通过。

### Slice B：Repository Source 与 Snapshot Store

范围：

- 安全文件发现、ignore 和 Manifest；
- SQLite schema/migration；
- immutable Snapshot；
- building/ready/failed/superseded；
- 原子 Ready pointer；
- Index/Sync/Status Module Interface。

验收：

- Store round-trip graph hash 一致；
- 构建中断后旧 Ready 可查；
- Snapshot 混读不可能发生；
- Scope 外路径无法读取；
- 增量/全量 Store 内容一致。

### Slice C：Query Module 与 CLI

范围：

- 六种 Query Interface；
- FTS5 Definition 检索；
- 有界 traverse/findPaths；
- Query Result、预算和稳定错误；
- CLI Transport。

验收：

- Definition/Evidence/调用/继承/路径 Fixture 通过；
- 排序和截断确定；
- stdout/stderr/退出码符合契约；
- 默认查询在 Zod v3 上满足 2 秒 timeout。

### Slice D：MCP 同源 Adapter

范围：

- 六个精确 MCP Tool；
- 与 CLI 共用 Schema、Query Module 和序列化；
- cross-project 显式 Scope；
- structuredContent。

验收：

- CLI/MCP golden JSON 语义等价；
- 未知字段、版本和枚举稳定失败；
- MCP 不会隐式 index/sync；
- Tool 无额外文件或 SQL 访问能力。

### Slice E：真实项目 Prototype Gate

范围：

- Zod v3 完整演示；
- Definition 定位；
- callers/callees；
- 路径；
- Evidence；
- 静态证据不足时拒绝强结论；
- Acceptance Receipt。

验收通过后，才能讨论 watcher、daemon、单一 explore Recipe、更多语言、SCIP 或 native kernel。

## 14. 测试与发布门禁

### 14.1 Relation Gold

每种 Relation 至少覆盖：

- 正常唯一解析；
- 零目标；
- 多目标；
- alias；
- 跨文件；
- 循环；
- 合法或非法自引用；
- syntax partial；
- stale/cross-snapshot Resolution；
- 错误 export visibility。

支持范围内必须 100% 命中 Gold，且不得产生 Gold 外的错误权威 Relation。

### 14.2 确定性

- 同一输入连续 10 次 graph hash 一致；
- 增量与全量规范图一致；
- Store 写入/读回 hash 一致；
- CLI/MCP 规范 JSON 一致；
- 文件枚举、并发完成顺序和数据库行顺序不能改变结果。

### 14.3 安全

- 默认断网；
- 不安装或构建目标 Repository；
- 不写回目标 Repository；
- symlink/path traversal 不能越过 Scope；
- Diagnostic、Receipt 和日志不得包含秘密或无预算源码全文。

### 14.4 阻塞发布的问题

以下情况不能作为 Known Limitation 交付：

- 已知错误权威 Relation/Evidence；
- Candidate/Resolution 身份不一致；
- Snapshot 混读；
- 增量与全量不等价；
- Store 损坏或非原子 Ready 切换；
- CLI/MCP 语义漂移；
- Freshness 静默降级；
- Scope 越权或源码外泄。

动态调用、反射、未支持语法和明确报告的 unresolved Candidate 可以作为 Known Limitation。

## 15. 完成定义

本 Spec 完成不以“代码量、表数量或语言数量”为判断，而以以下用户链路为准：

```text
scb index --repo <repository>
→ scb status
→ scb definitions find
→ scb graph traverse
→ scb graph paths
→ scb evidence get
→ 同一请求经 MCP 得到语义等价结果
```

链路中的每个结果都必须绑定 Ready Snapshot，回显 Freshness、Coverage、Completeness 和 Evidence；任何不确定关系都必须保持可见但不冒充权威事实。
