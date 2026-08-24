# V0.1 Benchmark 方法与样本组合

## 结论

V0.1 应采用一个**分层、版本冻结、以结构事实为主的本地 Benchmark**：用小型受控 Fixture 检验每条图语义，CodeGraph 自举检验自身真实架构，外部 TypeScript/Python 项目检验跨项目泛化；将“图查询正确性”与“Agent 借助图回答问题的效率”拆成两个轨道。不要把单次成功、可见 Gold 或公开仓库的 LLM 回答当作能力结论。

这个选择沿用了三类一手证据：CrossCodeEval 通过静态分析筛出真正需要跨文件上下文的样本，并同时报告代码匹配与标识符匹配；[CrossCodeEval 官方论文页](https://crosscodeeval.github.io/)；RepoBench 显式区分第一次跨文件使用、随机跨文件使用和纯文件内使用；[RepoBench 官方源码](https://github.com/Leolty/repobench/blob/main/README.md)；SWE-bench 则用 fail-to-pass 与回归测试评价真实仓库任务，并使训练仓库与评测仓库不重叠；[SWE-bench 论文](https://proceedings.iclr.cc/paper_files/paper/2024/file/edac78c3e300629acfe6cbe9ca88fb84-Paper-Conference.pdf)。

## 目标、假设与成功标准

**目标**：在不把源码送到外部服务的前提下，可靠比较 `baseline（rg/grep + 文件读取）` 与 `CodeGraph + 同一 Agent` 在 TypeScript/Python 静态代码理解问题上的正确率、完成时间、源码读取文件数和 Token 开销。

**假设**：V0.1 只对确定的静态事实负责；因此正确性应由固定提交上的符号、关系和可定位证据判定，而不是由自由文本“看起来合理”判定。Agent 是使用图的被测消费者，图本身也必须独立受测。

**成功标准**：

- 每题有冻结的仓库提交、题面、Gold、证据锚点和判分器；另一台干净机器可重放同一结果。
- 每个支持的关系至少有一个 Fixture 正例、一个跨文件真实项目正例，及一个应当拒答/降级的反例。
- 报告同时给出正确率和成本分布，且以相同题目、相同运行条件下的配对结果比较两个轨道。
- 任何无法双人复核、不能在冻结环境运行、或 Gold 可能暴露给被测 Agent 的题目均不进入主分数。

## 推荐样本组合（V0.1）

| 层 | 数量与语言 | 每层问题 | 目的与纳入规则 |
| --- | --- | --- | --- |
| A. 受控 Fixture | 4 个：2 TypeScript、2 Python；各 5 题，共 20 题 | 定义/导入别名/导出、继承或实现、跨文件调用、阴性事实 | 每个 Fixture 只含 4–12 个源码文件；手写、可完全审计，覆盖阴影同名、别名、循环导入或动态派发等明确边界。 |
| B. CodeGraph 自举 | 当前 CodeGraph 的一个固定提交，12 题 | CLI/MCP 入口到解析、存储、解析/图查询的跨模块路径；仅问当前工具承诺支持的静态关系 | 是“真实但已知”的 dogfooding 层；独立于 A 层计分，不允许题目只复述 README 或测试名。 |
| C. 外部真实项目 | 每种语言 2 个项目；每项目 8 题，共 32 题 | 每项目覆盖定义定位、导入/导出、调用/被调用、两跳影响、继承/实现、阴性/不确定一题 | TypeScript 与 Python 分层均衡；只选许可、提交、依赖安装和测试都可复现的项目。 |

合计 **64 题**。每个配置每题独立运行 5 次，主对比为 320 次 Agent run；图内核的确定性查询可额外连续运行 10 次来检验结果稳定性。这是 V0.1 可控的规模：A 层定位语义错误，B 层发现自举盲点，C 层防止只对手写样本过拟合；三层不得混成一个总分，而应先按层、语言和难度报告，再给加权汇总。

Codebase Memory 的公开报告采用 12 类问题、PASS/PARTIAL/FAIL、真实开源仓库，且记录最多 5 次尝试，说明“关系类别 + 复试记录”是有用的审计形态；但它的重试是逐步升级策略，不能当作独立重复实验。[Codebase Memory 官方 Benchmark 报告](https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/docs/BENCHMARK.md)

### 外部项目筛选门槛

候选项目先以同一张清单筛选，而不是按熟悉度挑选：

1. OSI 兼容许可、公开可克隆、非镜像/非生成物仓库；固定到 tag 或完整 commit SHA，并记录源码树 SHA-256。
2. 主语言占可索引源码 ≥70%，TypeScript 与 Python 各自独立成层；排除 vendored、minified、生成目录和大二进制文件。
3. 有锁文件、支持的本地运行时版本、干净容器内可安装，且至少有一个原生测试命令；连续两次冷启动安装/测试均成功才入选。
4. 规模设为 80–800 个可索引源码文件、2k–50k 定义节点的目标区间；每种语言各选一个库型项目、一个应用/CLI 型项目，避免架构单一。
5. 至少有真实 import/export、接口/基类或协议、跨目录调用；抽样后必须能产生各难度层题目，不能则替换项目。
6. 记录原始仓库 URL、许可、commit、运行时/包管理器版本、锁文件 hash、排除规则和可复跑命令；这些是语料清单的一部分。

CrossCodeEval 同样从宽松许可的多语言开源仓库取样，并用“去掉 import 后静态分析出现未定义名”的方法确认样本确实依赖跨文件上下文；该思路直接支持第 1、2、5 条。[CrossCodeEval 的数据构造说明](https://crosscodeeval.github.io/)

## 题目分级与题面格式

每题只验证一个主结论，输出必须为结构化 JSON：`answer`、`evidence[]`（稳定 symbol id + path + range）、`confidence`（`confirmed`/`insufficient_static_evidence`）。禁止自由长文代替证据。

| 级别 | 占比目标 | 题型 | 判定 |
| --- | ---: | --- | --- |
| L0 定位 | 20% | 某定义/导出/导入别名在哪，唯一标识为何 | 精确 symbol id 与位置。 |
| L1 单关系 | 30% | 调用、继承/实现、导入、导出的一跳关系 | 精确集合；集合题报告 precision、recall、F1。 |
| L2 跨文件路径 | 30% | 从入口到处理器、两跳 caller/callee、影响面 | 有序路径或无序影响集合；每条边须有证据。 |
| L3 边界与反例 | 20% | 同名遮蔽、动态属性/反射、条件导入、未解析调用 | 正确拒答或标记 `insufficient_static_evidence` 才得分；猜测记错。 |

每层、每语言均保留 L0–L3，不把“难”简单等同于仓库大。RepoBench 的 `cross_file_first`、`cross_file_random` 与 `in_file` 三设置可作为 L1/L2 与 L0 的抽样参照；[官方设置说明](https://github.com/Leolty/repobench/blob/main/README.md)。CrossCodeEval 同时使用 exact match、编辑相似度和 identifier match，说明本 Benchmark 的集合/标识符判分应与自由文本分离；[官方评测说明](https://crosscodeeval.github.io/)。

## Ground Truth 与泄漏防护

### 建立 Gold

每道题维护一份不可变 `case.json`：`case_id`、层/语言/难度、repo URL、commit SHA、索引配置 hash、题面、候选源文件清单、期望 JSON、允许别名、证据锚点（file SHA-256 + range）和 Gold 审核记录。

1. 出题人从固定提交先写自然语言题面和独立的人工答案；不得从当前系统输出反推 Gold。
2. 第二位审核人不看出题人的答案，按源码重建关系；两份答案取交集/分歧表。若不能一致，改题或删题，不以“部分猜对”掩盖歧义。
3. 对 L0–L2，以独立的 AST/LSP/编译器查询或最小可执行断言复核；对 L3，写出不能静态确认的具体原因。所有判分脚本只读 `case.json` 与实际输出。
4. Gold、隐藏测试、审核注释存入 evaluator 挂载，**不挂载给 Agent**；Agent 工作目录只有目标提交和准入工具。评测日志也不能回写到题库。

固定提交与评价元数据是成熟做法：RepoClassBench 的任务记录包含 `commit_id`，并提供用于验证实现的评价元数据；[RepoClassBench 官方源码](https://github.com/microsoft/repoclassbench)。SWE-bench 对每个实例至少保留一个 fail-to-pass 测试并运行额外回归测试，支持将“证据正确”与“未破坏既有行为”分开验证；[SWE-bench 论文](https://proceedings.iclr.cc/paper_files/paper/2024/file/edac78c3e300629acfe6cbe9ca88fb84-Paper-Conference.pdf)。

### 防泄漏和项目过拟合

- `manifest` 与运行镜像只写完整 commit SHA；题库名、Gold 路径、测试名、预期 symbol 名均不出现在 Agent prompt、工作目录、MCP 描述或工具错误信息中。
- 基准维护库和目标仓库分离；评测时以只读、无网络的临时工作目录 checkout 目标 commit，Gold/evaluator 在另一进程或另一挂载点。禁止 Agent 读取 `.git` 历史、Issue/PR、文档题库和评测日志。
- 按**仓库**而非按题目切分 dev/holdout；一项目的任何题都不能跨两侧。SWE-bench 同样将训练仓库与评测仓库做不相交处理；[SWE-bench 论文](https://proceedings.iclr.cc/paper_files/paper/2024/file/edac78c3e300629acfe6cbe9ca88fb84-Paper-Conference.pdf)。
- Fixture 的名称和符号采用非提示性命名，并保留另一批未发布的变体（重命名、重排目录、等价实现）作为 smoke holdout；外部项目必须用题目编写截止日之前的 commit，并披露公开仓库无法完全排除模型预训练污染这一限制。
- 主结论只来自 holdout；Fixture 用于诊断，CodeGraph 自举用作兼容性门槛，不能用任一层的成功宣称对所有项目泛化。

## 运行与遥测合同

### 两条独立轨道

1. **结构内核轨道**：向图 API/CLI 直接发等价的结构查询，不调用 LLM；度量 query correctness、index 时间、query P50/P90、图结果大小。它回答“图是否正确”。
2. **Agent 轨道**：baseline 与 CodeGraph 使用同一 Agent、系统提示、问题、模型版本、令牌/时间上限与本地只读 checkout；唯一变量是可用的本地探索工具。它回答“图是否帮助完成任务”。

Agent 运行的 wall clock 从发送题面到收到最后一个结构化 JSON；另报 `index_cold`、`index_warm` 和 `answer_time`，不把首次建索引悄悄摊入回答时间。使用单调时钟、固定 CPU/内存上限、无网络容器、固定 OS/image digest、运行时与包管理器版本、模型 ID/快照、采样参数、工具版本和随机种子。SWE-bench 已将评测迁移到 Docker 以提高可复现性，V0.1 应复用“容器化 evaluator”的原则。[SWE-bench 官方 README](https://github.com/SWE-bench/SWE-bench/blob/main/README.md)

### 四项主指标的精确定义

| 指标 | 定义 | 必须保存的原始证据 |
| --- | --- | --- |
| 正确率 | L0 exact；L1/L2 集合 F1 与“全对”比例；L3 拒答正确率。主分数为每题 0/1，诊断分数另报 F1。 | 题目输出、判分 JSON、Gold 版本 hash。 |
| 回答时间 | `answer_time_ms`：题面首字节到最终 JSON 的单调时钟差；超时记失败并单报。 | 每次 run 的起止 monotonic timestamp、timeout 原因。 |
| 源码读取文件数 | `unique_source_files_read`：一次 run 中，Agent 收到至少一个目标源码字节的去重相对路径数；另报总 read 次数与源码字节数。只返回 symbol/path 等元数据的图查询不计“读源码”。 | 不可变工具事件流：tool、路径、字节数、响应 hash、时间。 |
| Token | 同时报供应商原生 `input_tokens`/`output_tokens`、工具返回 UTF-8 字节数，以及为横向比较计算的固定 tokenizer token 数；不得只报某一方。 | 每轮模型与工具的计量记录、tokenizer 名称/版本。 |

应把“读取的文件少”解释为成本信号，不是正确性的替代品；必须同时报告成本更低但错误的比率。CrossCodeEval 明确在不同跨文件上下文设置下比较性能，且其官方代码把生成与指标计算分开，这支持将上下文成本与正确性分开记录；[CrossCodeEval 官方评测代码说明](https://github.com/amazon-science/cceval/blob/main/README.md)。

## 重复次数、统计与报告

**执行规则**：默认 temperature=0、固定其他采样参数、每个 `case × condition` 独立 5 次；如提供方即使 temperature=0 仍非确定，五次都保留，不取最好一次。确定性内核查询运行 10 次；任何输出 hash 不一致都列为稳定性缺陷。5 是 V0.1 的成本/方差折中，不是文献宣称的通用充分样本量；扩展版本应依据试运行的方差和目标置信区间重新做功效规划。

**统计规则**：以题目为配对单位，在题目内比较 baseline 与 CodeGraph 的 5 次结果；用按语言、层、难度分层的分层 bootstrap（重采样题目，再重采样其重复 run）计算 95% CI。正确率报均值差与胜/平/负题数；时间、文件数、Token 报中位数、P50/P90、配对中位数差和 CI。不要把同一题的 5 次当成独立题目，也不要只展示最好一次。

**最小报告表**：

| 条件 | 题数 / run 数 | Correct@1（95% CI） | L1/L2 F1 | L3 拒答正确率 | answer P50/P90 | 文件 P50/P90 | input/output token P50/P90 | 超时/解析失败 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 按层、语言拆行 |  |  |  |  |  |  |  |
| CodeGraph | 按层、语言拆行 |  |  |  |  |  |  |  |

同时发布 `manifest`、容器 digest、runner 配置、匿名化运行 trace、题目/Gold 的内容 hash、原始逐 run CSV 和判分器版本；可公开的 Fixture 与许可允许的目标提交可完整发布。SWE-bench 的可复现性声明也将收集、评价、推理等组件分别记录并发布，这是本合同的发布粒度参照；[SWE-bench 论文](https://proceedings.iclr.cc/paper_files/paper/2024/file/edac78c3e300629acfe6cbe9ca88fb84-Paper-Conference.pdf)。

## V0.1 决策

采用 4 Fixture + 1 CodeGraph 自举 + 4 外部真实项目、64 题、每题每条件 5 次的三层评测；先以结构内核轨道阻断错误关系进入 Agent 测试，再用成对 Agent 轨道报告正确率与成本。实现 Benchmark Contract 时应把本文件的 `case.json`、运行 trace、Gold 隔离、指标定义和报告表固化为验收条件；不在本票实现任何 runner、Fixture 或产品功能。
