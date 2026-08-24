# 研究 P0～P7 开源项目能力地图

Type: research
Status: resolved
Blocked by:
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

Semantic Codebase 的 P0～P7 每个阶段应借鉴哪些开源项目的哪些能力；哪些适合直接复用、通过 Adapter 接入、只借设计思想或暂缓采用，才能优先快速形成原型并避免重复造轮子？

## Comments

- 已认领；只使用项目官方仓库、官方文档和当前已拉取源码作为依据，形成一份长期维护的阶段能力地图。

## Answer

完整结论见 [Semantic Codebase P0～P7 开源项目能力地图](../research/open-source-capability-map.md)，详细核验记录分为 [P0～P2](../research/open-source-map-p0-p2.md)、[P3～P4](../research/open-source-map-p3-p4.md) 和 [P5～P7](../research/open-source-map-p5-p7.md)。

原型阶段只直接采用 Tree-sitter、SQLite 自有 GraphStore，并把 CodeGraph/Kythe 作为实现与模型参考；core 跑通后再验证 scip-typescript Adapter。P3 以后按真实瓶颈逐层接入，Archify 仅作为 P7 构建期展示器。GitNexus、Codebase Memory 等身份、许可或副作用边界不充分的项目不进入当前依赖图。
