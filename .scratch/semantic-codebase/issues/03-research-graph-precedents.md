# 研究图模型、存储与查询基础设施先例

Type: research
Status: resolved
Blocked by:
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

比较 Kythe、Infigraph、CodeGraph、SCIP 消费端及其他必要的一手实现，研究 V0.1 的 Node/Edge/Fact/Anchor、仓库与版本隔离、增量更新、持久存储、路径查询和来源追踪可以借鉴哪些成熟约定。结论应区分“必须进入自有统一模型的概念”和“应保留在 Adapter 内部的实现细节”，并说明 SQLite、属性图或其他候选方案的最小必要能力。

研究结果写入 `../research/graph-precedents.md`，只使用官方文档、规范和源码。

## Answer

V0.1 应以不可变 Snapshot 内的 Definition、Relation、Fact 与 Evidence 为统一模型，显式保留范围、Adapter 来源与确定性；SQLite（双向邻接索引、单写事务、递归 CTE/有界 BFS）足以作为默认 Store，Kythe/SCIP/CodeGraph/Infigraph 的协议与物理实现保留在 Adapter/Store 内部。详见 [研究资产](../research/graph-precedents.md)。

## Comments
