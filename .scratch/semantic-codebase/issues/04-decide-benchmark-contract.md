# 确定 V0.1 Benchmark 与验收契约

Type: grilling
Status: resolved
Blocked by: 01
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

V0.1 最终采用哪些样本、问题层级、Ground Truth、Agent 基线、重复策略和报告格式；“结构正确率不退化、读取文件数下降至少 60%、Token 下降至少 50%、跨语言契约与确定性测试通过”分别如何精确定义，哪些是硬门槛，哪些只是观察指标？

## Comments

## Answer

V0.1 采用三层、64 题的 Release Benchmark：4 个受控 Fixture 共 20 题、固定 CodeGraph 自举提交 12 题、TypeScript/Python 各两个外部真实项目共 32 题。题目覆盖 L0 定位、L1 单关系、L2 跨文件路径和 L3 边界/拒答；日常开发只运行确定性内核与小型 Smoke，候选版本才运行完整 Agent 评测。

正式报告保留传统 `rg/read` Baseline、CodeGraph 参考组和自研 V0.1 三组。每题每组独立运行 5 次，因此两组发布门槛对比为 640 runs，包含 CodeGraph 参考组时为 960 runs。发布结论只由 `V0.1 vs Baseline` 决定，CodeGraph 不作为发布裁判。

Gold 由人工先写，使用独立 AST/LSP/编译器查询或最小断言复核，再由第二个 Agent 独立检查；冲突由人裁决，无法明确裁决的题目删除。Gold、隐藏测试和审核材料与 Agent 工作目录隔离。

正式分数使用用户现有的 Codex 托管 Agent，不部署本地模型。只有冻结的公开开源 Benchmark Corpus 可以进入托管模型；私有、内部或敏感源码不得用于该路径。正式运行固定仓库提交、客户端与工具版本、可见的模型/产品标识、上下文与超时配置，并保存运行日期和逐 run 原始数据。由于托管服务无法按模型权重完全冻结，报告必须明确披露服务漂移这一复现限制。

硬发布门槛：

- Fixture 支持范围正确率 100%。
- 确定性索引连续 10 次规范化结果 hash 完全一致。
- TypeScript/Python 公共契约测试 100% 通过。
- V0.1 相对 Baseline 的 Correct@run 实质性非劣界为 -2 个百分点，并报告分层 bootstrap 95% CI；该容忍不适用于已知确定性错误。
- 源码读取文件数中位数下降至少 60%，模型输入 Token 中位数下降至少 50%。
- Gold 隔离、固定提交和受控网络全部通过：目标源码只允许通过 Codex 服务所需出口，Gold、隐藏测试、评测日志和其他网络访问均不可达。
- 结构化输出解析失败率不高于 1%。

回答时间、冷/热索引时间、P90 Token 和工具调用次数在 V0.1 作为观察指标。报告必须按 Fixture/自举/外部项目、TypeScript/Python、L0～L3 分层公开正确率、F1、正确拒答率、时间、文件数、源码字节、Token、失败和五次运行稳定性，并保存逐 run 原始数据及环境 hash；加权总分不能作为唯一结论。

研究依据：[V0.1 Benchmark 方法与样本组合](../research/benchmark-method-and-corpus.md)。

## Decision amendment

用户随后明确决定不部署本地模型。上面的当前 Answer 已据此改为“现有 Codex + 仅公开冻结 Corpus”；原本地模型研究保留为历史资产，但不再属于实施路线。

## Decision amendment: 精简 V0.1 Agent 验收

用户随后确认完整 960-run Release Benchmark 对内部 V0.1 交付过重。V0.1 的发布硬门槛改为两部分：

1. 不调用模型的本地确定性验证，包括 Fixture 结构契约、TypeScript/Python 一致性、连续 10 次索引 hash、全量/增量等价、Snapshot/查询/错误契约和隐私隔离。
2. 16 题 × Baseline/V0.1 两组 × 2 次的 64-run Agent Smoke，用于发现工具不可用、明显正确性回退、结构化输出失败和 Token/源码读取方向性恶化。

64-run Smoke 不足以支持“文件数下降至少 60%”“输入 Token 下降至少 50%”或 -2 个百分点非劣界等对外量化结论；这些数字从内部 V0.1 发布硬门槛移到完整 Evidence Benchmark。Smoke 只报告原始分层结果、差值和限制，不做统计显著性宣传。

原 64 题、三组、五次、960-run 方案保留为可选 Evidence Benchmark，仅在对外发布量化数据、P2→P3 重大投资决策或建立长期公开回归基线时运行。CodeGraph 继续作为设计和实现参考；它不进入强制 Smoke。
