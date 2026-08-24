# 确定 Graph Store 与结构查询 Interface

Type: grilling
Status: resolved
Blocked by: 03, 06, 07
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

Graph Store 应隐藏哪些存储、索引和遍历复杂度，向调用者提供哪些最小查询能力才能覆盖 Definition 查找、调用者、被调用者、依赖、影响范围和路径查询；是否需要公开通用图查询语言，如何表达查询预算、截断、排序、循环、缺失关系和来源证据？

## Comments

## Answer

V0.1 直接以 SQLite 实现一个深的 GraphStore Module，不设计通用数据库插件体系。SQLite 表、WAL、FTS、事务与 CTE/BFS 都属于 Implementation；只有将来出现第二种真实存储时才抽取 Store Adapter seam。

Index Module 独占 Snapshot 发布和回收写入权，Query Module 完全只读。调用者不能直接新增 Definition、修改 Relation、执行 SQL 或绕过 Snapshot 验证。

V0.1 Query Interface 只提供：

```text
status(repository)
findDefinitions(scope, filter, budget)
getDefinition(scope, definition_key)
getEvidence(scope, evidence_ids, source_budget)
traverse(scope, seeds, direction, relation_kinds, budget)
findPaths(scope, from, to, relation_kinds, budget)
```

一跳 callers/callees/dependencies 使用 `traverse(max_depth=1)`，不增加重复 Interface。每次查询必须提供 `repository_id、snapshot=explicit_id|current_ready、require_fresh`；响应始终回显实际 `snapshot_id、revision、freshness`。

所有查询统一返回：

```text
QueryResult<T>
├── snapshot
├── data
├── completeness
│   ├── complete
│   ├── truncated
│   ├── reason
│   └── budget_used
├── coverage
│   ├── indexed_files
│   ├── skipped_files
│   ├── unresolved_candidates
│   └── failed_adapters
└── evidence_refs
```

没有结果只能解释为“本 Snapshot 索引中未找到”；只有 `complete=true` 且 Coverage 充分时才允许调用者做更强判断，仍不得宣称动态代码中绝对不存在。

所有遍历必须有预算，V0.1 默认值/硬上限为：

```text
max_depth       3 / 8
max_nodes     500 / 5000
max_results    50 / 500
max_paths      20 / 100
timeout_ms   2000 / 10000
source_bytes 16KB / 128KB
```

触达预算返回 `truncated=true` 与原因，不能把部分结果伪装成完整结果。具体默认值可由 Benchmark 后续调整，但无界查询不属于合法 Interface。

排序必须确定：Definition 按精确 qualified name、精确 name、前缀、文本分数、Definition Key；Traverse 使用 BFS 最短深度，再按 Relation kind/Key；Paths 按最短跳数和 Relation Key。Traverse 全局去重节点，单条 Path 不允许节点重复。

结构查询默认只返回 Definition 摘要和 Evidence 引用；只有显式 `getEvidence` 才返回受预算限制的源码片段。V0.1 不公开 SQL、Cypher 或自定义图查询字符串，也不内置含义模糊的 `impact` 操作；影响范围由调用者显式选择 Relation kinds、方向和深度调用 traverse。
