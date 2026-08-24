# 确定 V0.1 的统一 Definition 与 Relation IR

Type: grilling
Status: resolved
Blocked by: 02, 03, 05
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

V0.1 的 Repository、File、Module、Class、Interface、Function、Method 应共享哪些最小字段，语言特有信息放在哪里；CONTAINS、CALLS、IMPORTS、INHERITS、IMPLEMENTS、REFERENCES 等关系如何表达方向、来源范围、确定性和 Adapter 能力差异；哪些扩展点必须保留给 P3～P7，哪些不应提前进入核心 Interface？

## Comments

## Answer

V0.1 Canonical IR 只表达“一个 Snapshot 中存在什么代码声明，以及已确认如何连接”。Repository 是查询命名空间，Snapshot 是不可变查询范围，SourceFile 是源码载体；三者都不冒充 Definition。

Definition 只包含 `module、class、interface、function、method` 五种 kind，共享最小字段：

```text
definition_key
snapshot_id
kind
language
name
qualified_name
file_key
container_key?
name_span
definition_span
content_hash
```

`signature、visibility、exported、async、decorators` 等非通用属性进入受控 Fact，不扩大所有 Adapter 和调用者必须理解的 Interface。Parameter、Variable、Constant、Property、Enum Member、Decorator、Route、Table、Document、Capability、Workflow 均不进入 V0.1 Definition kind。

Relation 只包含以下七种，并固定方向：

```text
CONTAINS    File/Definition -> Definition
IMPORTS     File/Module -> File/Module
EXPORTS     File/Module -> Definition
CALLS       caller Definition -> callee Definition
INHERITS    subclass -> superclass
IMPLEMENTS  implementation -> interface
REFERENCES  referring File/Definition -> referenced Definition
```

每条 Relation 的最小字段为：

```text
relation_key
snapshot_id
kind
source_ref
target_ref
origin
derivation
evidence_ids[]
```

`origin` 受控为 `tree_sitter、scip、resolver`，`derivation` 受控为 `extracted、static_derived`。V0.1 不使用浮点 confidence；启发式或 LLM 结论不能进入权威 Relation。

只有唯一解析出两个端点的连接才能成为 Relation。动态调用、同名冲突或环境缺失产生 `RelationCandidate + diagnostic/coverage`，不伪造 Relation；查询未找到边时必须同时暴露 unresolved/coverage，不能宣称语义上不存在。

每个 Definition 与 Relation 至少绑定一份 Evidence。规范源码定位使用字节半开区间 `[start_byte,end_byte)`，并保存 `file_key、original_position_encoding、adapter_name/version、config_digest、source_digest`；行列号由查询层基于 Snapshot 源码计算。

语言特有扩展统一使用：

```text
Fact
- subject_ref
- namespace
- key
- typed_value
- schema_version
- evidence_ids
```

Fact namespace 必须注册并版本化，Adapter 不得向公共输出写入无约束 JSON。

明确不进入 V0.1 Canonical IR：跨 Snapshot Lineage、Cluster/Domain/Capability/Workflow、CFG/DataFlow/PDG/Taint、Document/Requirement/ADR/PR/Issue、Embedding/LLM Summary，以及 SQLite、Cypher、SCIP protobuf、Tree-sitter AST 和 Adapter 内部解析结构。
