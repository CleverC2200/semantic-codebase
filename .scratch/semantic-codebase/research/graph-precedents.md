# 图模型、存储与查询基础设施先例

> 对应票据：[研究图模型、存储与查询基础设施先例](../issues/03-research-graph-precedents.md)。
>
> 范围：为 Semantic Codebase V0.1（单仓库、本地、TypeScript/Python、确定事实）收敛图的**概念边界与最低基础设施能力**；不选择最终 schema，不实现 Adapter，也不决定跨版本 Definition 连续性（留给“确定 Definition 身份与版本连续性”）。

## 结论

V0.1 应以“**不可变 Graph Snapshot 内的 Definition、Relation、Fact 与 Evidence**”作为统一模型，而不是以任一外部协议的节点表或某个图数据库的标签表作为模型。每个查询必须指定 `repository_id + snapshot_id`；Definition 的可展示名称、文件位置和 Adapter 符号键都是该快照的属性/证据，不是跨版本恒等性的结论。

以 SQLite 为默认 Graph Store 已足够：关系表加双向邻接索引、快照范围索引、外键和单写入事务即可覆盖 V0.1；递归 CTE 或 Store 内的有界 BFS 可完成路径与影响查询。FTS5 只服务候选 Definition 检索，不能替代结构遍历。Kùzu/Neo4j 等属性图后端应留在 Store Adapter 后，等多仓库、任意 Cypher 和规模数据证明必要性后再引入。

## 一手先例与可采纳边界

| 先例 | 已验证的成熟约定 | V0.1 采用 | 不直接照搬 |
| --- | --- | --- | --- |
| [Kythe Storage Model](https://kythe.io/docs/kythe-storage.html) / [Schema](https://kythe.io/docs/schema/) | `VName` 将 corpus、root、path、language 与 opaque signature 组合为可寻址身份；`Entry` 是附着于节点或边的原子 Fact；事实名可命名空间扩展。 | 以稳定的仓库身份、快照、来源 Adapter 和不透明外部键构成命名空间；采用可附着于实体/关系的显式 Fact。 | 不将 Kythe ticket/VName 或任意字节 Fact bag 暴露为自有 ID/API；V0.1 用受控字段与 JSON 扩展，防止无法查询和无约束语义。 |
| [Kythe Anchor 指南](https://kythe.io/docs/schema/writing-an-indexer.html) / [Schema Overview](https://kythe.io/docs/schema-overview.html) | Anchor 是文件中可重叠的范围，定义/引用 Anchor 经 `defines/binding`、`ref` 指到抽象语义节点；Kythe offsets 是字节且为 `[start,end)`。 | 将源码范围作为可独立定位的 Evidence，Relation 和 Fact 均可指向它；内部规范统一半开区间，并保存原始位置编码。 | Anchor 不进入 V0.1 的 Definition 核心种类；它是支持某个事实的证据，避免“每一次出现都是业务实体”。 |
| [SCIP 协议](https://github.com/scip-code/scip/blob/main/scip.proto) / [消费说明](https://github.com/scip-code/scip/blob/main/docs/scip.md) | `Index` 是一个工作区的**完整**索引；metadata 先于可流式 documents；document 有规范相对路径、位置编码、occurrences 与 symbol metadata/relationships，外部 symbol 可独立提供。 | SCIP Adapter 按 document 流式转换为当前 Snapshot 的 Definition、Occurrence Evidence 与 Relation；保留 `tool_info`、协议版本、原始 symbol、position encoding。 | SCIP 本身没有 commit、增量 delta 或跨次持久身份语义；不得把一次导入直接当作自有版本生命周期。不要默认保存 `Document.text`，协议也建议消费者从文件系统取文本。 |
| [CodeGraph 源码](../../../references/codegraph/src/types.ts) / [Schema](../../../references/codegraph/src/db/schema.sql) / [工作方式](https://colbymchenry.github.io/codegraph/core-concepts/how-it-works/) | AST 抽取与解析分两阶段；本地 SQLite 表拆分 nodes/edges/files/unresolved refs，并以 FTS5、WAL、文件 hash 与每文件原子替换支持增量；其 Edge 有 `tree-sitter/scip/heuristic` provenance。 | 借鉴“抽取原始关系→解析补全→明确 provenance”和“按文件内容 hash 识别改动、一次事务替换该文件派生产物”。 | `NodeKind`/`EdgeKind` 枚举、qualified-name hash、未解析引用队列、Tree-sitter heuristics、MCP 输出格式均是 CodeGraph Adapter/实现细节，不是统一 IR。 |
| [Infigraph schema](https://github.com/intuit/infigraph/blob/main/crates/infigraph-core/src/graph/schema.rs) / [GraphBackend](https://github.com/intuit/infigraph/blob/main/crates/infigraph-core/src/graph/backend.rs) / [index 命令](https://github.com/intuit/infigraph/blob/main/crates/infigraph-cli/src/index.rs) | 嵌入式 Kùzu 的标签化 Symbol/Module/File/Relation 表可直接执行 Cypher；`GraphBackend` 遮蔽 Kùzu/Neo4j；按文件 hash 增量，单文件替换后重解析相关边，并为共享 Neo4j 写入仓库 namespace。 | Store Interface 必须遮蔽 SQLite/属性图库；Repository namespace 和文件 hash 是必要输入；解析与入库由 Store 原子拥有。 | Symbol/Concern/Cluster/Embedding/TAINT_FLOW 等标签、任意 Cypher、Neo4j/Postgres/pgvector 与远程多仓库是 P3+ 或规模驱动能力，不能撑大 V0.1 核心。 |

## 自有统一模型：必须进入 V0.1 的概念

### 1. 版本隔离是第一层，而不是 Node 属性

```text
Repository (稳定本地配置身份)
  └─ Graph Snapshot (不可变：source_revision + tree/content manifest + adapter run)
       ├─ File version
       ├─ Definition instance
       ├─ Relation instance
       ├─ Fact
       └─ Evidence ──> Source span / tool run / input digest
```

- `Repository`：本地单仓库命名空间，不能用绝对路径充当可共享身份；可保存配置生成的稳定 UUID 与可变的根路径。
- `GraphSnapshot`：不可变查询边界，至少含 `snapshot_id`、source revision（有 Git 时为 commit OID；否则为完整 manifest digest）、创建时间、Adapter 版本和状态（building/ready/failed）。**所有** Definition、Relation、Fact、Evidence 都带 `snapshot_id`。
- `FileVersion`：规范相对路径、内容 digest、语言、字节长度/编码；删除、重命名和换分支由新 Snapshot 的 manifest 表达，不原地改历史。
- `DefinitionInstance`：当前快照内的可寻址实体，最小字段为内部 ID、kind、名称、qualified/display name、container（可空）、FileVersion、定义范围、可见性/导出状态（可空）。`adapter_key`（例如 SCIP symbol 或分析器生成键）与 `adapter_id` 允许重放和去重，但不宣称它等于跨版本稳定身份。
- `RelationInstance`：同一 Snapshot 内 `source_definition_id`、`target_definition_id`、受控 `kind`、可空序号/属性、确定性等级和 Evidence 集。边方向必须固定（例如 `CALLS: caller → callee`、`CONTAINS: container → child`）；反向邻居由查询提供，不能由 Adapter 重复造边。
- `Fact`：受控 `namespace + key + JSON/scalar value`，宿主为 Definition、Relation 或 FileVersion。Fact 记录值的语义，不记录“工具说过什么”；每条 Fact 通过 Evidence 可追溯。允许额外命名空间，且必须声明 schema/Adapter 所有者与版本。
- `Evidence`：来源类型、`repository_id/snapshot_id/file_version_id`、半开 SourceSpan、内容 digest、产生该项的 Adapter 名称/版本/配置 digest、原始键（SCIP symbol/VName 等）、确定性（`compiler|static|heuristic`）和可选诊断。一个事实可有多份证据；解析失败也应作为带诊断的 Evidence/Run 记录，而非伪造关系。

这里吸收 Kythe 的关键分离：语义实体可以没有位置，而位置 Anchor 连接源码与语义；Kythe 同时证明“Fact + 有向边 + 可扩展命名空间”足以承载异构分析器。[Kythe Storage Model](https://kythe.io/docs/kythe-storage.html) 规定 Entry 为图存储的原子编码单位，且 node/edge 均由共享键的 Entry 集合形成；[Schema Overview](https://kythe.io/docs/schema-overview.html) 明确 Anchor 表示文件范围、语义节点可不直接关联文件。

### 2. 来源与范围不能压扁

SourceSpan 至少保存：`file_version_id`、`start_line/start_character/end_line/end_character`、`position_encoding`、可选 `start_byte/end_byte`。统一 API 采用 `[start,end)`；SCIP 中行/列是 0-based、并按每 Document 的 `PositionEncoding` 解释，Kythe 则规定 Anchor 用 byte offsets。因此 Adapter 必须保留原始编码再转换，不能把 UTF-16 列当字节列。[SCIP proto](https://github.com/scip-code/scip/blob/main/scip.proto) 对 `Document.position_encoding` 和 typed ranges 有明确约定；[Kythe Indexer 指南](https://kythe.io/docs/schema/writing-an-indexer.html) 要求 Anchor 使用字节、起始含而结束不含。

### 3. 一致性与增量

1. 建立新 Snapshot，写入状态为 `building`；从上一 ready Snapshot 比较 `path + content_digest`，产生新增、修改、删除集。
2. 每个变动文件由 Adapter 重新产生 Definition、Fact、Occurrence Evidence、候选 Relation；先写临时/新 Snapshot 范围，绝不修改上一 ready Snapshot。
3. 重新解析所有受影响的跨文件 Relation（含引用它的文件），再做完整性校验：端点、Evidence 范围、唯一性、Adapter run 状态。
4. 单事务将 Snapshot 标为 `ready` 并切换 Repository 的 `current_snapshot_id`；失败只留下 `failed` run/snapshot，不可被查询。当输入与 Adapter 配置 digest 相同，重复运行必须幂等地得到相同可见 Snapshot。

CodeGraph 的 `FileRecord.contentHash`、每文件落库事务和 `unresolved_refs`→解析阶段说明“仅替换改动文件的派生数据，再补跨文件关系”可行；Infigraph 的 `get_file_hashes`、`upsert_file`/`re_resolve_for_files` 也把 hash、写入与重解析职责收进 Backend。它们都是实现佐证，不应暴露给统一模型调用者。

SCIP `Index` 的“一个根目录下完整工作区”定义和流式读取建议意味着：SCIP 导入应先形成候选 Snapshot；它既不声明增量，也不携带 Git revision，故 source revision 必须由外层采集并写入 Adapter Run。[SCIP proto](https://github.com/scip-code/scip/blob/main/scip.proto)

## Graph Store：SQLite 的最小必要能力

V0.1 默认本地 SQLite Store，最小物理表可为：

- `repositories`、`snapshots`、`adapter_runs`、`file_versions`：隔离、可重建与失败审计；
- `definitions`：`(snapshot_id, id)` 唯一，索引 `(snapshot_id, name)`、`(snapshot_id, file_version_id)`、`(snapshot_id, container_id)`；
- `relations`：`(snapshot_id, source_id, kind, target_id, ordinal)` 唯一，索引 `(snapshot_id, source_id, kind)` 与 `(snapshot_id, target_id, kind)`；
- `facts`、`evidence`、`evidence_links`：宿主索引、`file_version_id + span` 索引、Adapter 原始键索引；
- 可选 `definitions_fts`（仅名称、文档、签名）作为候选召回索引，而不是事实源。

SQLite 的 WAL 允许读写并行但始终只有一个 writer，正好匹配“一个 Snapshot 发布事务”的 V0.1 约束；不要把多 writer 当成吞吐优化目标。[SQLite WAL](https://www.sqlite.org/wal.html) 说明 WAL 中读者不会阻塞写者、但同一时间只有一个 writer。FTS5 是 token→文档/位置倒排索引，适合名字/文档找种子 Definition，不表达图可达性。[SQLite FTS5](https://www.sqlite.org/fts5.html)

属性图后端的必要门槛是：单机 SQLite 的有界邻接查询已被基准证明不能满足规模、需要跨仓库/团队并发或必须公开通用 Cypher。Infigraph 已展示 Kùzu/Neo4j 后端抽象的可行性，但其 remote namespace、向量与业务派生边不是 V0.1 的依据。

## 查询 Interface：路径、预算和证据

调用者不应接触 SQL、Cypher、表名或 Adapter。最低公开能力：

1. `findDefinitions(snapshot, text/kind/file, limit)`：返回候选及其定义 Evidence；
2. `getDefinition(snapshot, id)` / `getSource(snapshot, evidence_id)`：返回实体、受控 Fact 与证据，不隐式读取工作树的另一版本；
3. `neighbors(snapshot, ids, direction, relation_kinds, limit)`：调用者、被调用者、包含关系、导入依赖的共同基础；
4. `traverse(snapshot, seeds, relation_kinds, direction, max_depth, max_nodes, ordering)`：影响面/依赖面；
5. `findPaths(snapshot, from, to, relation_kinds, max_depth, max_paths, max_nodes)`：返回有序 Relation 路径，每一步带 relation 与 Evidence ID；
6. `snapshotStatus(repository)`：显式报告 ready/building/failed、revision、Adapter run 与陈旧原因。

路径与遍历回应必须返回 `truncated`、实际预算消耗、循环去重规则和遗漏/不确定性（例如 heuristic、unresolved）。不得把“未找到路径”表达为“语义上不存在关系”。SQLite 的递归 CTE 能走树和图，且官方示例明确建议以 `LIMIT` 给递归设安全上界；实现也可用 Store 内 BFS 保持路径排序与逐步预算控制。[SQLite WITH RECURSIVE](https://www.sqlite.org/lang_with.html)

## Adapter 内部细节清单

以下信息允许保留用于复现、调试或优化，但不得成为跨 Adapter 的 Product API：

- Kythe VName/ticket、entry 排序、`/kythe/*` fact/edge 标签、Anchor VName 生成算法；
- SCIP protobuf 分块、`Occurrence.symbol_roles`/typed-range 解码、external symbol 缓存、indexer 命令行；
- Tree-sitter AST、查询模式、语言 grammar 版本、未解析引用队列、名称匹配与 framework synthesizer；
- CodeGraph 的 Node/Edge 枚举、qualified-name hash、`unresolved_refs`、SQLite DDL/PRAGMA、FTS 触发器；
- Infigraph 的 Kùzu label/rel table、Cypher 文本、Neo4j/Postgres/embedding、Cluster/Concern/taint 等派生分析；
- mtime 缓存、worker 批量大小、WAL checkpoint、锁文件和网络/本地后端连接细节。

这些细节可经 `AdapterRun` 的名称、版本和配置 digest 被追溯；统一模型只接收其产出的确定 Fact/Relation 与来源证据。

## 待后续票据决定

- “确定 Definition 身份与版本连续性”：何时把相邻 Snapshot 的两个 DefinitionInstance 认定为同一稳定 Definition，及 rename/move/split/merge 的不确定表达。
- “确定 V0.1 的统一 Definition 与 Relation IR”：最终 kind 集合、Relation 属性和 Fact namespace 注册表。
- “确定索引、版本快照与增量更新生命周期”：revision 获取、保留策略、重建阈值、原子发布与恢复细节。
- “确定 Graph Store 与结构查询 Interface”：查询排序、路径语义、预算默认值、错误与 provenance 返回结构。
