# 原型化 V0.1 CLI 与 MCP 使用契约

Type: prototype
Status: resolved
Blocked by: 04, 08, 09
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

用最低成本的命令帮助、JSON 示例和 MCP Tool 形状，让人能够实际比较单一 Explore Interface 与多条精确查询 Interface：哪个形状最容易发现 Definition、查询调用关系、路径和影响范围，并能稳定用于 Benchmark？原型只用于共同评审交互契约，不实现索引或查询引擎。

## Comments

- 已认领；本轮用可双击运行的交互原型比较单一 Explore Interface 与精确查询 Interface，不实现真实索引或 Graph Store。
- 评审原型：[CLI / MCP 使用契约交互原型](../prototypes/cli-mcp-contract.html)。它用相同场景比较结构化单入口、精确多查询和双入口混合三种 Interface，并展示请求、QueryResult、隐式默认值与 Benchmark 可复现性。
- HITL 第一轮：用户接受推荐，确定以精确多查询作为 V0.1 唯一权威 Interface 与正式 Benchmark Interface；单一 Explore 和双入口混合均不进入 V0.1 权威契约。
- HITL 第二轮：用户接受 CLI/MCP 共用六种操作语义且 Scope 全部显式；成功响应统一携带 Snapshot、Completeness、Coverage 与 Evidence；V0.1 不增加 callers、callees、impact 或 recipe 快捷操作。
- HITL 第三轮：用户接受带产品前缀的六个 MCP Tool、严格版本化 JSON、CLI/MCP 同源序列化、稳定错误与退出码，以及 V0.1 不分页、不默认内联源码。

## Answer

V0.1 采用精确多查询作为唯一权威 Agent Query Interface，也是正式 Benchmark 唯一暴露的工具集合。结构化单一 Explore 与双入口混合均不进入 V0.1；自然语言规划和通用 Context Recipe 留给 P3 Context Engine。

### 操作集合

CLI 提供：

```text
scb status
scb definitions find
scb definition get
scb evidence get
scb graph traverse
scb graph paths
```

MCP 提供六个对应 Tool：

```text
semantic_codebase_status
semantic_codebase_find_definitions
semantic_codebase_get_definition
semantic_codebase_get_evidence
semantic_codebase_traverse
semantic_codebase_find_paths
```

CLI Adapter 与 MCP Adapter 共用同一个 Contract Module、Query Module 与规范序列化器。两者不得分别解释默认值、排序、错误、预算或查询语义。

不提供独立的 callers、callees、dependencies、impact 或 recipe 操作：callers 是 `traverse(direction=in, relation_kinds=[CALLS], max_depth=1)`；callees 使用 `direction=out`；所谓影响范围必须由调用者明确选择方向、Relation kinds 和深度。

### Query Scope 与 Benchmark

每次调用必须显式传入：

```text
repository_id
snapshot = explicit_id | current_ready
require_fresh
```

CLI 可显式使用 `--repo .`，但不得把 cwd、环境变量或最近项目作为未声明的 Scope。`current_ready` 在查询开始时原子解析为一个不可变 Snapshot ID；查询过程中不能跨 Snapshot。

正式 Benchmark 必须使用显式 Snapshot ID、完整 Query Budget、固定 Tool Schema 和固定工具描述，不能依赖 `current_ready` 或默认预算。报告同时记录 Agent 可见调用次数和底层 Query Module 操作成本。

### 共享 JSON 契约

请求与响应都携带 `schema_version: "0.1"`，字段统一使用 `snake_case`。所有 Schema 设置 `additionalProperties: false`；未知字段、未知枚举和不支持版本返回 `INVALID_ARGUMENT`，不得静默忽略。

每个成功响应都是：

```text
QueryResult<T>
├── schema_version
├── snapshot
├── data
├── completeness
├── coverage
└── evidence_refs
```

空结果和预算截断都是成功结果。截断必须令 `complete=false`、`truncated=true`，并回显首先触发的预算原因与实际消耗；Coverage 不足仍需原样返回，不能把“未找到”改写为“代码中不存在”。

V0.1 不提供 cursor 或 offset 分页。结果超限时，调用者必须缩小过滤条件、关系集合或深度后重新查询。结构查询默认只返回 Evidence 引用；源码只能由 `semantic_codebase_get_evidence` / `scb evidence get` 显式获取，并受 `source_bytes` 总预算限制。

### Transport 与错误

- MCP 的权威对象写入 `structuredContent`；为兼容文本客户端，`content[].text` 只能承载同一对象的规范 JSON，不能生成另一套自然语言回答。
- CLI 的 stdout 只输出单个规范 JSON 对象；进度与诊断写入 stderr。
- CLI 退出码：`0` 表示成功（含空结果或 truncated）；`2` 表示参数或 Schema 非法；`3` 表示 Repository、Snapshot 或 Freshness 条件不满足；`4` 表示内部查询失败。
- 稳定错误码至少包括 `INVALID_ARGUMENT`、`REPOSITORY_NOT_FOUND`、`SNAPSHOT_NOT_FOUND`、`NO_READY_SNAPSHOT`、`SNAPSHOT_NOT_READY`、`STALE_SNAPSHOT` 与 `INTERNAL_QUERY_ERROR`。

### 原型结论

[CLI / MCP 使用契约交互原型](../prototypes/cli-mcp-contract.html) 用定位 Definition、查询 callers、查找路径、结构影响和预算截断五类场景比较了三种 Interface。精确多查询的 Tool 数量更多，但它没有隐藏操作选择、关系方向或预算，因此在 V0.1 的可解释性、测试 Locality 和 Benchmark 复现性上最强。常用组合暂时只写成文档示例，待真实 Agent Benchmark 证明存在稳定重复模式后，再决定是否在 P3 引入版本化 Recipe。
