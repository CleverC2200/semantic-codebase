# 研究 TypeScript 与 Python 的抽取 Adapter 路线

Type: research
Status: resolved
Blocked by:
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

针对 V0.1 的 TypeScript 与 Python Definition/Relation 抽取，CodeGraph、SCIP 及其语言 Indexer、Tree-sitter 和可能的 LSP 语义来源分别能提供哪些确定事实，集成成本、精度、增量能力、许可证和运行约束是什么？重点判断 CodeGraph 应作为运行时 Adapter、实现参考还是仅作 Benchmark 对照，以及 SCIP 在两种语言上的真实可用边界。

研究结果写入 `../research/extraction-adapters.md`，结论必须来自官方仓库、规范、源码和许可证。

## Comments

## Answer

V0.1 以 Tree-sitter 作为双语言内建语法基线；SCIP 作为版本绑定的离线语义富集（先 TypeScript，Python 受 Pyright/环境约束后再按 benchmark 决定）；CodeGraph 只作实现参考与 P0 对照，不进入权威运行时抽取路径。详见[研究资产](../research/extraction-adapters.md)。
