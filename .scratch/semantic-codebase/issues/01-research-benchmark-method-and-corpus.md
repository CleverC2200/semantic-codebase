# 研究 V0.1 Benchmark 方法与样本组合

Type: research
Status: resolved
Blocked by:
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

基于 Codebase-Memory 等项目的官方 Benchmark、代码探索研究和可复现实验方法，V0.1 应如何构造“小型受控 Fixture + CodeGraph 自举 + TypeScript/Python 外部真实项目”的评测集，才能可靠测量正确率、回答时间、源码读取文件数和 Token，同时避免答案泄漏、项目过拟合和不可复现的 Agent 波动？给出候选项目筛选标准、问题分级、Ground Truth 建立方法、重复次数和统计报告建议。

研究结果写入 `../research/benchmark-method-and-corpus.md`，只使用官方文档、官方源码、论文或一手 Benchmark 资料。

## Comments

## Answer

建议采用“4 个受控 Fixture + CodeGraph 自举 + 4 个外部 TypeScript/Python 项目”的三层、64 题评测；把确定性结构内核与同 Agent 的图辅助问答分轨，冻结 Gold 并隔离，按题目配对各运行 5 次，报告正确率、时间、源码读取文件数与 Token 的分布及 95% CI。

研究资产：[V0.1 Benchmark 方法与样本组合](../research/benchmark-method-and-corpus.md)。
