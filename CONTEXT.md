# Semantic Codebase

Semantic Codebase 是面向人和 AI Agent 的软件认知模型。它把源代码及其证据组织成可查询、可追溯并能逐级压缩的信息，而不是替代源代码本身。

## Repository Boundary

- 当前仓库是 Semantic Codebase 自研项目的唯一 Git 根目录。
- 自研实现从仓库顶层开始，`references/` 中的源码只用于研究、比较和验证设计。
- `references/zod/` 是冻结的真实项目测试语料，`references/codegraph/` 是外部 CodeGraph 快照；二者都不是当前产品源码或独立 Git 仓库。
- 早期 Slice 1 原型已退役，仅通过历史验收收据和本地发布前备份保留证据。

## Language

**Semantic Codebase**:
位于源代码之上的软件语义模型，统一表达定义、关系、行为、证据、能力和认知视图。
_Avoid_: Code Graph、代码文档平台

**Definition**:
某个 Snapshot 中可寻址的代码声明，例如函数、类、接口或方法；V0.1 不把它视为跨版本稳定的语义实体。
_Avoid_: Symbol、代码节点

**Snapshot**:
仓库在特定 revision、源码清单和索引配置下形成的不可变分析视图，是 Definition 与结构事实的版本作用域。
_Avoid_: 当前代码、工作区状态

**Ready Snapshot**:
已经完整抽取、解析并通过一致性验证，可以作为查询事实来源的 Snapshot。
_Avoid_: Building Snapshot、部分索引

**Freshness**:
Ready Snapshot 的源码 Manifest 与当前观察到的源码 Manifest 是否一致；它描述索引是否最新，不描述图中事实本身的可信度。
_Avoid_: Confidence、Correctness

**Definition Key**:
Definition 在一个 Snapshot 内可重复计算的技术地址；它用于查询和 Evidence 定位，不代表跨版本逻辑身份或 Capability 身份。
_Avoid_: Global ID、Semantic ID

**SourceFile**:
Snapshot 中承载源码内容、Definition 和 Evidence 的文件版本；它是分析载体，不是代码声明或业务实体。
_Avoid_: Definition、Module

**Relation**:
同一 Snapshot 中两个已唯一解析对象之间有方向的确定结构连接，并由 Evidence 支持。
_Avoid_: Relation Candidate、可能依赖

**Relation Candidate**:
由于动态行为、名称冲突或环境缺失而无法唯一解析的可能连接；它用于覆盖率和诊断，不属于权威 Structural Graph。
_Avoid_: Relation、低置信度边

**Fact**:
由已注册且版本化的 namespace 定义、附着于分析对象并由 Evidence 支持的类型化属性。
_Avoid_: 任意 JSON、Adapter metadata

**Canonical IR**:
所有 Source Adapter 与 Graph Store 共同遵守的最小 Definition、Relation、Fact 和 Evidence 模型，不暴露具体解析器或存储实现。
_Avoid_: Database Schema、SCIP Index

**Syntax Adapter**:
从单个 SourceFile 提取确定性语法声明、关系候选和 Evidence 的分析角色；它不声称完成仓库级语义解析。
_Avoid_: Source Adapter、Parser

**Semantic Enricher**:
在冻结的 Repository 和基础语法事实上补充仓库级解析结果与 Evidence 的可选分析角色。
_Avoid_: Compiler Adapter、SCIP Adapter

**Adapter Profile**:
一次 Snapshot 构建所要求的、带版本与配置的分析能力集合；它决定该 Snapshot 承诺具备哪些语言和关系能力。
_Avoid_: Runtime Mode、自动降级策略

**Query Scope**:
一次结构查询所针对的 Repository、Snapshot 和 Freshness 要求；查询结果必须回显实际使用的 Snapshot。
_Avoid_: 当前项目、默认数据库

**Completeness**:
查询是否在声明的预算和已索引数据范围内完整执行，以及是否因预算或错误发生截断。
_Avoid_: Correctness、Coverage

**Coverage**:
一个 Snapshot 中哪些源码和 Adapter 能力已成功分析、跳过、失败或仍有未解析候选。
_Avoid_: Completeness、Confidence

**Query Budget**:
一次查询允许消耗的深度、节点数、结果数、路径数、时间或源码字节上限。
_Avoid_: Rate Limit、Token Budget

**Query Result**:
绑定一个实际 Snapshot 的结构查询结果，同时携带数据、Completeness、Coverage 和 Evidence 引用，使调用者能够区分空结果、部分结果与分析缺口。
_Avoid_: Response、搜索结果

**Structural Graph**:
由 Definition 及其确定性结构关系构成的图，例如包含、调用、导入、继承、引用和读写。
_Avoid_: Semantic Graph、Knowledge Graph

**Context Package**:
针对一个问题或任务，从图中选择并压缩出的有限上下文，包含相关定义、关系、源码证据和不确定性。
_Avoid_: 搜索结果、文件列表

**Evidence**:
支持某项事实、推导或语义判断的可追溯来源，包括源码范围、测试、文档、配置和版本信息。
_Avoid_: Explanation、Reason

**Capability**:
系统为业务或用户提供的稳定能力，由代码、数据、规则、流程和证据共同实现，不等同于目录或结构聚类。
_Avoid_: Module、Cluster、Feature

**Cognitive Compiler**:
把同一软件语义模型投影并压缩为不同角色、任务和认知分辨率所需视图的机制，不产生新的事实来源。
_Avoid_: 文档生成器、架构图生成器

**Decision Map**:
由目标、已解决决策、开放决策和迷雾区组成的规划索引；完成意味着实施前不再存在关键决策空缺。
_Avoid_: Roadmap、开发任务列表

**Benchmark Contract**:
约束产品能力结论如何被可重复评测、判分和发布的协议，包含样本、Gold、运行条件、指标与硬门槛。
_Avoid_: Benchmark 结果、性能测试脚本

**Agent Smoke**:
用少量冻结问题验证 AI Agent 能否通过产品 Interface 正确完成代表性任务，并发现明显正确性回退或成本方向恶化；它不支持精确的对外量化声明。
_Avoid_: 完整 Benchmark、模型评测

**Evidence Benchmark**:
为对外量化结论或重大阶段决策执行的完整、重复 Agent 评测；它不是内部 V0.1 的日常发布门槛。
_Avoid_: Agent Smoke、日常回归测试

**Benchmark Epoch**:
在同一冻结 Corpus、Gold、模型 Profile、工具契约、资源限制和隔离策略下完成的一组可比较运行；跨 Epoch 结果不得直接合并。
_Avoid_: Benchmark 批次、运行日期

**Benchmark Receipt**:
使一次 Agent 评测可复核的非敏感记录，包含输入与环境摘要、原始结果、资源使用、评分和失败分类。
_Avoid_: 日志、测试报告

**Prototype Gate**:
首次可体验实现必须通过的最小可信验证，只证明核心使用链路可运行、结果可追溯且没有已知错误事实或越权行为。
_Avoid_: Release Gate、完整验收

**Release Gate**:
产品进入内部 V0.1 发布前必须按顺序通过的完整验证集合；它在原型方向被接受后执行。
_Avoid_: Prototype Gate、测试清单

**Known Limitation**:
允许随版本交付且已明确披露的能力边界，必须说明影响范围、Evidence、用户可见 Diagnostic 和解除条件；已知错误不属于 Known Limitation。
_Avoid_: Bug、待办事项

**Gold**:
在与被测 Agent 隔离的条件下独立建立并复核的预期结构事实及其源码证据，是 Benchmark 判分的权威依据。
_Avoid_: 参考答案、模型生成答案
