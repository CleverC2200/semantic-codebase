# P5～P7 开源能力地图

> 对应票据：[研究 P0～P7 开源项目能力地图](../issues/16-research-open-source-stage-map.md)。
>
> 核验日期：2026-08-17。只引用项目官方仓库、项目官方文档或标准发布方。这里的“采用”是后续实施时的默认技术判断，不是立即引入依赖、联网服务或改变 V0.1 的决定。

## 结论先行

| 阶段 | 默认借鉴组合 | 本阶段不做 |
| --- | --- | --- |
| P5 Software Knowledge Graph | 自有 `Fact + Evidence + AdapterRun + Snapshot` 为事实核；借 [PROV-O](https://www.w3.org/TR/prov-o/) 的 provenance 词汇边界；可选导入 Graphify 的本地确定性抽取结果；只有 P4 已有运行证据时才接 OpenTelemetry Adapter。 | 不把任何外部图格式、RDF 三元组、LLM 摘要或动态 Trace 当权威事实；不默认扫描/上传私有文档。 |
| P6 Capability Graph | 借 [Backstage Catalog](https://backstage.io/docs/features/software-catalog/) 的 `Domain → System → Component/API/Resource` 分层、归属与双向关系；把 Graphify/GitNexus 的聚类仅用作候选提示。 | 不从目录、社区聚类或模型摘要自动发布“Capability”；不把 `owner` 当权限、审批人或运行时授权。 |
| P7 Cognitive Compiler | 自有、可追溯的 Projection/Story 编译器；直接复用 [Archify](https://github.com/tt-a1i/archify) 作为已验证投影的本地展示/导出器；借 [Structurizr](https://docs.structurizr.com/) 的模型—视图分离与 C4 分层。 | 不让图表工具推断系统拓扑；不把漂亮的概览、LLM 讲解或社区划分误报为事实。 |

这三阶段沿用 V0.1 的基础约束：每个输入、推导、投影和展示都必须能回到 `repository_id + snapshot_id + Evidence`。开源项目只能位于 Adapter、候选生成或展示层，不能替代自有 Semantic/Evidence/Capability Model。

## 采用顺序与闸门

```text
P5：冻结的文件/外部工件
    → AdapterRun（来源、版本、配置、输入 digest）
    → Fact / Relation / Evidence
    → 已审计的 Software Knowledge Snapshot

P6：P5 已审计证据 + 人工声明
    → Capability Candidate（可解释、可拒绝）
    → 人工接受/修改/合并
    → Capability Graph

P7：用户任务 + P5/P6 已接受事实
    → 有预算的 Projection / Story
    → Evidence-linked View Model
    → Archify Artifact 或结构化 JSON
```

进入下一阶段的共同前置条件是：输入范围、快照、来源许可和 Evidence 保留策略已经明确；低置信/推断结果不得悄悄升级为已接受事实。

## 候选项目逐项判断

### Graphify — P5 文档/配置知识 Adapter，P6/P7 候选提示

- **官方链接：**[官方仓库](https://github.com/Graphify-Labs/graphify)、[官方快速开始](https://graphify.com/docs)。当前仓库说明可把代码、文档、SQL schema、配置和 PDF 映射为可查询图；代码使用 Tree-sitter，本地确定性代码解析；边区分 `EXTRACTED` 与 `INFERRED`。非代码材料可能请求助手模型或配置的 API。
- **身份、活跃与许可证：**Graphify Labs 的公开官方仓库；2026-08-17 的 GitHub 元数据为活跃、未归档、当前 **Apache-2.0**。其发布说明记录最近从 MIT 改为 Apache-2.0，采用时应锁定提交和许可证文本，不能仅按旧文章的 MIT 结论处理。
- **可借能力：**异构本地工件接入、Tree-sitter 多语言抽取、显式“直接抽取 / 推断解析”边标记，以及把图结果提供给 CLI/MCP 的产品形态。
- **采用方式：****Adapter（受限）**。P5 可以建立一次性导入 Adapter：只接收本地、允许范围内的确定性代码/文本输出；将每条输入标成 `external_adapter=graphify`、版本、配置 digest、源文件 digest，并把 `EXTRACTED`/`INFERRED` 映射为自有 certainty/provenance。P6 只可把其聚类/报告作为 Capability Candidate 的候选线索；P7 可参考其“报告 + 可问图”的交互，不复用其结论。
- **不照搬：**不把 `graph.json` 当 Canonical IR；不引入其可选模型/API、网页摄取、PDF/图像语义理解或自动安装 Agent skill；不把 `INFERRED` 边提升为事实或 Capability。
- **采用前置条件：**每次导入固定版本和命令配置；文件许可、敏感数据与网络策略通过；同一快照的重复导入结果可比较；至少抽样复核 Evidence 的定位。若目标包含私有源码，禁止启用任何可能联网的 ingest/模型路径。

### Understand Anything — P7 体验参考，不进入事实管线

- **官方链接：**[官方仓库](https://github.com/Egonex-AI/Understand-Anything)、[官方 README 的运行说明](https://github.com/Egonex-AI/Understand-Anything/blob/main/README.md)。官方描述它以多 Agent 流程建立文件、函数、类和依赖图，并提供本地只读 Dashboard；其解析明确为 Tree-sitter 与 LLM hybrid。
- **身份、活跃与许可证：**Egonex-AI 的公开官方仓库，README 明确“originally created by Lum1104”；2026-08-17 元数据为活跃、未归档、**MIT**。身份链清晰但所有权已迁移，锁版本时应以 Egonex-AI 主仓为准。
- **可借能力：**“探索、搜索、提问、按层深入”的认知入口；将文件—符号—依赖的解释放在图形阅读器中，而非只输出全局大图。
- **采用方式：****借思想**。P7 的 Cognitive Compiler 可用任务导向的渐进披露、局部路线和解释面板；仅当其输出经 P5 Evidence 回填并复核时，才可作为人工研究素材。
- **不照搬：**不把多 Agent/LLM 生成的图、摘要、架构判断或 Dashboard 数据导入权威 Graph；不把其插件安装、目录布局或前端复制成产品依赖。
- **采用前置条件：**如果开展体验对照，放在隔离公开语料中，记录模型、提示词和运行时间；P7 的每个叙述必须引用自有已接受 Fact/Capability，不能依赖模型记忆。

### GitNexus — P6 候选生成对照，暂不接入

- **官方链接：**[官方仓库](https://github.com/abhigyanpatwari/GitNexus)、[官方运行手册](https://github.com/abhigyanpatwari/GitNexus/blob/main/RUNBOOK.md)、[官方 Cursor 集成说明](https://github.com/abhigyanpatwari/GitNexus/blob/main/gitnexus-cursor-integration/README.md)。它提供本地/浏览器代码知识图、MCP 与查询、影响面、Cypher、可选 embeddings 和本地 Web UI；官方集成会安装 MCP、skills，并可配置 hooks。
- **身份、活跃与许可证：**应以 `abhigyanpatwari/GitNexus` 为官方源，**不是**搜索中常见的 `nxpatterns/gitnexus` fork；2026-08-17 主仓活跃、未归档。但 GitHub API 的仓库和 `/license` 元数据均为 **NOASSERTION**，没有可验证的开源许可证。这是阻止复制、分发或链接为产品依赖的硬风险。
- **可借能力：**将“影响分析、符号上下文、变更检测、聚类/流程图”组织成不同的 Agent 查询；索引陈旧状态显式暴露；图存储一次只允许一个进程打开的运行约束。
- **采用方式：****暂不采用**（仅隔离对照与设计参考）。P6 可在公开、临时仓库里比较其聚类是否能提高 Capability Candidate 召回，但不得把它的输出当 Gold 或写入生产图。
- **不照搬：**不复制源码、数据库格式、MCP 工具名、skills、hooks、提示词、Kùzu/Cypher 结果或 embeddings 管线；不运行 `setup/analyze` 于用户工作仓，以免写入 MCP 配置、skills、hooks、`AGENTS.md`/`CLAUDE.md` 等环境状态。
- **采用前置条件：**只有许可证得到上游明确补全且完成安全/可重复性审查后，才重新评估 Adapter；评估必须隔离工作树、`--index-only` 或等效只读路径、无凭据、无自动安装。即使许可补齐，也需要把输出逐条回链到文件和自有 Evidence。

### Backstage Software Catalog — P6 声明式能力/系统模型 Adapter

- **官方链接：**[Software Catalog 概览](https://backstage.io/docs/features/software-catalog/)、[实体描述格式](https://backstage.io/docs/features/software-catalog/descriptor-format/)、[标准关系](https://backstage.io/docs/features/software-catalog/well-known-relations/)、[官方仓库](https://github.com/backstage/backstage)。Catalog 以源码旁的 YAML 为来源；其 `Component`、`API`、`Resource`、`System`、`Domain`、`Group/User` 和 `providesApi`、`consumesApi`、`dependsOn`、`partOf`、`ownedBy` 等关系正好提供组织语义的可读模板。
- **身份、活跃与许可证：**CNCF Backstage 官方项目；2026-08-17 主仓活跃、未归档、**Apache-2.0**。
- **可借能力：**能力图的层次语言（Domain/System/Component/API/Resource）；声明式 `catalog-info.yaml`；一对正反关系的规范化；Catalog processor 派生 `relations`，并把它们视为读取端的权威关系这一处理模式。
- **采用方式：****Adapter + 借思想**。P6 增加可选 `BackstageCatalogAdapter`，只读取明确列入 manifest 的 `catalog-info.yaml`，把每项声明和 processor 产生关系分别存为带文件范围的 Evidence；映射为 `CapabilityCandidate`、组织/系统上下文和显式依赖。模型分层、正反关系和可扩展命名空间也可被借用。
- **不照搬：**不嵌入整个 Backstage Portal、Catalog backend、数据库或权限系统；不把 `backstage.io/v1alpha1`、其 YAML schema 或 entity ref 变成自有永久 API；不把 `owner` 用作访问控制、自动任务分派或真实性证明。官方文档明确 owner 主要用于展示，不能作为运行时授权。
- **采用前置条件：**用户/组织先定义自有 Capability taxonomy 与“声明、静态证据、人工接受”的优先级；指定可读目录、实体 namespace 和冲突解决规则；每个 `owner`、API、依赖均保留源 YAML Evidence；未维护的声明须显示 freshness，而非冒充当前事实。

### Structurizr — P7 模型/视图分离参考

- **官方链接：**[官方文档首页](https://docs.structurizr.com/)、[models as code 说明](https://docs.structurizr.com/as-code)、[官方 UI 仓库](https://github.com/structurizr/ui)。官方将它定义为面向 C4 的 “models as code”：从一个模型产生多个架构视图。
- **身份、活跃与许可证：**Structurizr 是 C4 作者维护的参考实现，官方文档仍可用；但截至核验日，公开的 `structurizr/ui`（MIT）、`structurizr/cli`（Apache-2.0）、`lite`（MIT）与 Java 工具均已归档，官方页面指向 vNext/合并工具迁移。因此**不能把旧仓库的活跃性、未来兼容性或现行部署许可当作已确认事实**。
- **可借能力：**一个稳定架构模型生成多种按受众收敛的 View；C4 的系统上下文/容器/组件分辨率；模型不等于布局和渲染的分离。
- **采用方式：****借思想**。P7 的 Cognitive Compiler 应明确 `Projection`（给谁、为什么、选择了哪些事实、预算）与 `View`（布局/主题/导出）分离；可提供 C4 风格的层级投影。
- **不照搬：**不把 Structurizr DSL/JSON 当内部模型；不依赖已归档 CLI/Lite/UI 作为产品运行时；不通过逆向工程自动宣布 C4 模型正确，也不把图层级替代 Evidence。
- **采用前置条件：**对外提供 C4 视图前，定义每层映射到 Capability/软件事实的规则、允许的省略与 Evidence 入口；若将来评估 vNext，需单独核验其许可证、离线能力、版本迁移和安全模型。

### Archify (`tt-a1i/archify`) — P7 本地可验证展示器

- **官方链接：**[官方仓库](https://github.com/tt-a1i/archify)、[项目页](https://tt-a1i.github.io/archify/)。该项目实际是 Agent Skill，不是代码图谱/知识库：由 typed JSON IR 生成架构、工作流、时序、数据流与生命周期图，并以验证/交付/可视检查生成自包含 HTML 和导出；可将节点回链到固定 commit 的源文件和行范围。
- **身份、活跃与许可证：**`tt-a1i/archify` 官方公开仓库；2026-08-17 活跃、未归档、**MIT**。README 也明确 2.x 是从 `Cocoon-AI/architecture-diagram-generator` 的 fork/rewrite，展示语义应以当前 Archify 文档为准。
- **可借能力：**“先有 typed IR、再校验、最后渲染”的交付链；确定性布局检查；自包含可分享 HTML；深链接、路径探测和 source evidence；变化以 Before/Delta/After 呈现。
- **采用方式：****直接复用（P7 的构建期展示器）**。自有 Cognitive Compiler 产出经过 Evidence 校验的 Archify JSON，由本地 Archify validate/deliver 流程渲染为演示与验收工件。它是第一阶段最适合直接复用的 UI 工具，不进入 P5/P6 的权威数据层。
- **不照搬：**不让 Archify 根据自然语言或仓库自行发明拓扑；不把它的 JSON IR、渲染器数据结构或交互状态当 Capability Model；不把“通过视觉校验”误称为语义正确性；不启用其不必要的外部资产/部署功能。
- **采用前置条件：**每个图节点/边都能映射到已接受的 Fact、Relation 或 Capability，并记录 `snapshot_id`、投影规则与 Evidence deep link；在提交前运行其 JSON 验证和 visual-check；图需要声明适用受众、遗漏范围与过期状态。变更图还必须固定 Before/After 两个 Snapshot。

### OpenTelemetry — P5 的可选动态 Evidence Adapter（依赖 P4）

- **官方链接：**[Trace API 规范](https://opentelemetry.io/docs/specs/otel/trace/api/)、[Trace semantic conventions](https://opentelemetry.io/docs/specs/semconv/general/trace/)、[Resource 概念](https://opentelemetry.io/docs/concepts/resources/)、[规范仓库](https://github.com/open-telemetry/opentelemetry-specification)。官方将 Trace 表述为由 Span 构成的 DAG，并为 Resource、Trace、Metric、Log 等定义语义约定；Resource 用属性标识产出 telemetry 的实体。
- **身份、活跃与许可证：**OpenTelemetry 官方规范/语义约定仓库；2026-08-17 都活跃、未归档、**Apache-2.0**。
- **可借能力：**动态行为的来源、资源、时间窗、属性与语义约定的标准化记录方式；把运行时调用与服务/部署实体关联；通过 trace/span identity 组织可追溯运行证据。
- **采用方式：****Adapter（后置、可选）**。只有 P4 的行为图路线已经确定时，P5 可导入脱敏、固定窗口的 OTel span/resource 作为 `runtime_observation` Evidence，例如“在某时间窗看到 service A 调用 service B”。OTel semantic-convention 名称可作为受控 Fact namespace 的参考。
- **不照搬：**不把 OTel collector、后端、trace DB、所有 semantic conventions 或 span attributes 嵌入核心；不把一次 trace 当成静态依赖或 Capability 的存在证明；不默认采集/保存请求体、用户标识、高基数属性、凭据或生产数据。
- **采用前置条件：**P4 已定义运行证据与静态关系的冲突语义；遥测的授权、脱敏、采样、保留期和删除路径获批；导入按 service/version/environment/time-window 建 Snapshot binding；结果必须标为 observed 而非 guaranteed/complete。

### PROV-O — P5 Evidence 生命周期词汇参考

- **官方链接：**[W3C PROV-O Recommendation](https://www.w3.org/TR/prov-o/)、[PROV Overview](https://www.w3.org/TR/prov-overview/)。PROV-O 将 PROV 数据模型表达为 OWL2 本体，目的是跨系统交换来源信息，并允许为具体领域扩展类与属性。
- **身份、活跃与许可证：**这是 W3C 于 2013-04-30 发布的 Recommendation，不是需集成的单一软件项目；规范稳定、但不代表 Semantic Codebase 必须使用 RDF/OWL 或某一运行库。它不存在“GitHub 包依赖许可证”问题；引用文字/术语仍须遵循 W3C 文档使用规则。
- **可借能力：**`Entity`（文件版本、抽取结果、关系）、`Activity`（AdapterRun、解析、人工审核、Projection build）、`Agent`（工具/人/服务身份）及其生成、使用、归因、派生关系；把“事实是什么”与“谁在何种活动中依据什么生成它”分离。
- **采用方式：****借思想**。P5 的 `Evidence`、`AdapterRun`、人工接受/拒绝及 P7 projection receipt 可映射到 PROV 的 Entity/Activity/Agent 语义；必要时在导出层提供 PROV-O/RDF，不改变本地 SQLite/JSON 权威模型。
- **不照搬：**不把通用 OWL 约束、RDF 三元组、IRI 设计、推理引擎或全套 PROV vocabulary 放进 V0.1/P5 核心；不因有 `wasDerivedFrom` 就宣称实体跨快照同一，版本连续性仍须自有规则。
- **采用前置条件：**先确定 Evidence 的最小字段、Agent/工具身份、输入/输出 digest、时间与 retention 语义；只有出现跨系统审计/交换需求时才设计 PROV-O 导出，并附公开 mapping 与 round-trip tests。

## 跨项目的硬边界

1. **权威性分层：**源码/声明/运行观测/启发式/LLM 产物必须有不同 certainty 与可见标签；任何外部项目的推断都不跨层升级。
2. **可复现性：**每次 Adapter 或 renderer 运行记录项目版本、命令配置、输入 manifest digest、输出 digest 和诊断；Graphify、GitNexus、Understand Anything 的“结果图”不能脱离这一收据直接缓存为事实。
3. **许可与供应链：**GitNexus 在可验证许可证缺失前只可阅读和隔离评估；Graphify 的许可证已发生变更；Structurizr 的旧公开工具已归档。三者均不适合以“默认生产依赖”的方式静默引入。
4. **隐私：**Graphify 非代码语义路径、Understand Anything 的 LLM hybrid、OTel 生产 telemetry 都可能越过本地确定性边界。私有源码或数据只有在当前用户明确授权且对应 Adapter 的联网/数据流得到审查时才能处理。

## 实施时的最小验证收据

| 引入点 | 最低收据 |
| --- | --- |
| P5 Graphify/Backstage/OTel Adapter | 输入清单与许可范围、Adapter 版本/配置、离线/联网状态、输出条数、Evidence 抽样回链、重复运行 diff。 |
| P6 Capability Candidate | 产生规则、所有支持 Evidence、置信/来源类别、人工接受/修改/拒绝记录、拒绝后不再自动复活的规则。 |
| P7 Archify/认知投影 | 用户任务、输入 snapshot、选择/省略预算、每节点边的 Evidence 链接、JSON validate、deliver/visual-check 结果、生成文件 digest。 |

## 官方来源清单

- [Graphify 官方仓库](https://github.com/Graphify-Labs/graphify) 与 [Security Model](https://github.com/Graphify-Labs/graphify/blob/v8/SECURITY.md)
- [Understand Anything 官方仓库](https://github.com/Egonex-AI/Understand-Anything)
- [GitNexus 官方仓库](https://github.com/abhigyanpatwari/GitNexus) 与 [RUNBOOK](https://github.com/abhigyanpatwari/GitNexus/blob/main/RUNBOOK.md)
- [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/) 与 [Descriptor Format](https://backstage.io/docs/features/software-catalog/descriptor-format/)
- [Structurizr 官方文档](https://docs.structurizr.com/) 与 [EOL/migration notice](https://docs.structurizr.com/eol)
- [Archify 官方仓库](https://github.com/tt-a1i/archify)
- [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/) 与 [Semantic Conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/) 与 [PROV Overview](https://www.w3.org/TR/prov-overview/)
