# 研究并冻结 V0.1 Benchmark Corpus

Type: research
Status: resolved
Blocked by: 04
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

按照已确定的 Benchmark Contract，筛选并验证两个 TypeScript、两个 Python 外部真实项目及其精确 commit，选择 CodeGraph 自举的固定提交，并形成可实施的 Corpus Manifest。每个候选必须核对许可、源码规模、主语言比例、锁文件与本地测试可复现性、Definition/Relation 题型覆盖、生成物与 vendored 排除规则；说明淘汰候选及原因。Fixture 只定义应覆盖的结构语义矩阵，不在本票实现样本代码或题目。

研究结果写入 `../research/frozen-benchmark-corpus.md`，关键事实必须引用项目官方仓库、许可证、锁文件或一手构建资料。

## Answer

V0.1 Corpus 已冻结为 Zod、Socket.IO、Poetry、Textual 四个外部项目与 CodeGraph `c6aaa20358cd6adcd04b87bdef8e5803ad146f3a` 自举提交；资产记录了完整 commit、许可证、规模、锁文件、官方构建入口、Fixture 语义矩阵、排除规则与淘汰候选。外部仓库未在本机克隆，双冷启动/原生测试保留为正式入库前硬门槛。详见[冻结清单](../research/frozen-benchmark-corpus.md)。

## Comments
