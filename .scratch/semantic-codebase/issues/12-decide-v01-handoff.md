# 确定 V0.1 实施切片与交接完整性

Type: grilling
Status: resolved
Blocked by: 11
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

在前置决策明确后，V0.1 应按什么纵向切片顺序实施，每个切片通过哪个公共 Interface 产生可验证价值；实施者开始工作前还需要哪些契约、样本、风险、非目标和验收信息，才能避免在开发阶段重新打开产品或架构决策？

## Comments

- 用户已明确只决定产品方向，实施与验证细节由 Agent 参考开源先例自行判断，并要求优先形成可体验原型；因此本票没有新增方向级 HITL 问题，按已接受决策完成技术收口。

## Answer

完整实施交接见 [Semantic Codebase V0.1 实施交接](../v01-implementation-handoff.md)。

V0.1 固定为八个纵向切片：首个可查询 Definition、基础结构关系、跨文件调用与类型关系、Snapshot/增量、完整查询契约、MCP 同源 Adapter、真实项目 Prototype Gate，以及方向确认后的 SCIP/Release Gate。每个切片都通过真实 Index/Query/CLI/MCP Interface 产生可验证价值，禁止以横向内部模块堆积冒充完成。

历史决策曾要求自有产品代码落在 `product/semantic-codebase/`、参考仓库位于 `projects/`，并先完成 Slice 1。该 Slice 1 后曾移入 `references/semantic-codebase/`，并于 2026-08-25 从当前工作区退役；历史实现可从本地发布前 Git bundle 恢复，本段不再是执行指令。
