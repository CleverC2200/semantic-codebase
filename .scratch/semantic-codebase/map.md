# 找到 Semantic Codebase V0.1 的可实施路径

> 历史状态：本地图记录早期 V0.1 路线。2026-08-24 起，早期实现已移入 `references/semantic-codebase/`，只作参考；当前自研代码从顶层 Semantic Codebase 仓库重新开始。涉及旧代码落点和“下一任务”的描述不再是当前执行指令。

Label: wayfinder:map

## Destination

形成一张覆盖 P0～P7 的长期决策地图，并把 P0～P2 的 V0.1 Code Intelligence 收敛成可直接交给一位主要开发者与 AI Agent 实施的产品和技术规格；地图只解决实施前决策，不执行产品开发。

## Notes

- 领域词汇以 [CONTEXT.md](../../CONTEXT.md) 为准。
- 开源项目、调研结论、采用状态和复审条件统一从 [开源参考索引](research/open-source-reference-index.md) 查询。
- 每次工作会话先使用 `wayfinder`；Grilling 票同时使用 `grilling` 和 `domain-modeling`，设计 Module 与 Interface 时使用 `codebase-design`。
- 规划主线固定为 P0 Benchmark → P1 Definition Registry → P2 Structural Code Graph → P3 Context Engine → P4 Behavior Graph → P5 Software Knowledge Graph → P6 Capability Graph → P7 Cognitive Compiler。
- V0.1 覆盖 P0～P2，优先服务 AI Coding Agent，支持 TypeScript 与 Python，提供 CLI + MCP，共享结构化 JSON 输出。
- V0.1 产品只处理确定事实与静态推导，索引、图谱和查询全部本地运行，所有结果绑定仓库版本。正式 Agent Benchmark 使用现有 Codex，只允许冻结的公开开源 Corpus 进入托管模型；私有、内部或敏感源码不得进入该评测路径。
- 不部署或维护本地模型运行时。托管模型无法按权重完全冻结，因此正式报告必须记录可见的模型/产品标识、运行日期、客户端版本、配置与逐 run 原始数据，并把服务漂移列为复现限制。
- 自有产品独立于参考项目；Semantic Model、Evidence Model 和 Cognitive Compiler 归自有实现，CodeGraph、SCIP、Joern 等通过 Adapter 接入。
- 资源假设为一位主要开发者加 AI Agent 辅助，以验收门槛推进，不承诺固定发布日期。
- 当前顶层 Semantic Codebase 是唯一 Git 仓库；Research 资产保存在 `research/` 并由对应票据链接。
- 用户只决定产品方向和是否继续投入；实现与验证细节由 Agent 参考现有开源项目自行判断。优先尽快形成可体验原型，只有方向变化、重大范围变化或不可逆选择才请求用户决策。

## Decisions so far

<!-- 已关闭票据的结论索引放在这里；开放票据通过 issues/ 和依赖关系查询。 -->

- [研究 TypeScript 与 Python 的抽取 Adapter 路线](issues/02-research-extraction-adapters.md) — Tree-sitter 是双语言语法基线，SCIP 为版本绑定的离线语义富集（先 TypeScript）；CodeGraph 仅作实现参考与 P0 对照。

- [研究图模型、存储与查询基础设施先例](issues/03-research-graph-precedents.md) — V0.1 以不可变 Snapshot 中的 Definition、Relation、Fact、Evidence 建模；SQLite 的双向邻接与有界遍历足够，协议和图数据库细节留在 Adapter/Store 内部。

- [研究 V0.1 Benchmark 方法与样本组合](issues/01-research-benchmark-method-and-corpus.md) — 采用分层冻结语料、内核/Agent 双轨、隔离 Gold 的 64 题五次配对评测，并按正确率与成本分布报告。

- [确定 V0.1 Benchmark 与验收契约](issues/04-decide-benchmark-contract.md) — 内部 V0.1 只强制本地确定性验证与 64-run Baseline/V0.1 Agent Smoke；960-run 三组评测及 60%/50% 量化结论改为可选 Evidence Benchmark。

- [研究并冻结 V0.1 Benchmark Corpus](issues/13-research-freeze-benchmark-corpus.md) — 外部语料冻结为 Zod、Socket.IO、Poetry、Textual 与固定 CodeGraph 自举提交；锁文件、排除规则和本地双冷启动门槛已明确。

- [确定 Definition 身份与版本连续性](issues/05-decide-definition-identity.md) — V0.1 只提供 Snapshot 内可重复计算的 Definition Key；跨版本 Lineage 不进入权威 IR，延后到 Evidence/Capability Graph 阶段按真实需求设计。

- [确定 V0.1 的统一 Definition 与 Relation IR](issues/06-decide-canonical-ir.md) — Canonical IR 限定为五类 Definition、七类已解析 Relation、受控 Fact 与必备 Evidence；候选、不确定推断、行为图和业务语义不进入 V0.1 权威图。

- [确定索引、版本快照与增量更新生命周期](issues/07-decide-index-snapshot-lifecycle.md) — V0.1 使用显式 index/sync/status、不可变 Snapshot、单 writer 与原子 ready 指针；增量必须等价于全量重建，陈旧查询必须显式标记。

- [确定 Graph Store 与结构查询 Interface](issues/08-decide-graph-store-query-interface.md) — SQLite GraphStore 隐藏持久化与遍历复杂度；六种只读结构查询统一携带 Snapshot、预算、Coverage、Completeness 与 Evidence，不公开 SQL/Cypher 或无界查询。

- [确定 Syntax Adapter 与 Semantic Enricher Seam](issues/09-decide-source-adapter-seam.md) — V0.1 分开逐文件语法抽取与仓库级语义富集；正式 `core` 档位不依赖 SCIP，实验档位必须显式声明能力、冲突、Coverage 与失败。

- [原型化 V0.1 CLI 与 MCP 使用契约](issues/10-prototype-cli-mcp-contract.md) — V0.1 采用六种显式结构查询作为唯一权威 CLI/MCP 与 Benchmark Interface；Scope、预算、版本、错误、Coverage、Completeness 和 Evidence 均使用同一严格 JSON 契约。

- [确定 V0.1 Agent Smoke 与可选 Benchmark 执行配置](issues/15-decide-benchmark-execution-profile.md) — 内部交付使用 `gpt-5.6-terra/high` 执行 64-run Baseline/V0.1 Smoke；完整 960-run 降为按需 Evidence Benchmark，运行隔离、轻量门槛与收据已冻结。

- [确定 V0.1 验证矩阵与发布门槛](issues/11-decide-validation-release-gates.md) — 首次实现只通过双语言主链路、确定性、增量等价、CLI/MCP 和真实项目演示的 Prototype Gate；方向确认后才执行四级 Release Gate 与 64-run Smoke。

- [研究 P0～P7 开源项目能力地图](issues/16-research-open-source-stage-map.md) — P0～P7 已明确直接复用、Adapter、设计借鉴与暂缓边界；当前原型只采用 Tree-sitter、自有 SQLite GraphStore、CodeGraph/Kythe 参考和后置 scip-typescript Adapter，Archify 留作展示器。

- [确定 V0.1 实施切片与交接完整性](issues/12-decide-v01-handoff.md) — 历史 V0.1 曾收敛为八个纵向切片并完成 Slice 1；该实现现位于 `references/semantic-codebase/`，不再是当前产品源码起点。

## Not yet specified

- P3 如何按任务、角色和 Token 预算排序、裁剪并解释 Context Package，要等 V0.1 Benchmark 和查询 Interface 暴露真实瓶颈后再精确定义。
- P4 哪些问题触发按需 Behavior Analysis、首批接入 Joern 还是 CodeQL，以及支持哪些语言，要等 P2 的结构图精度边界明确后再定义。
- P5 的 Document、SQL、Config、Requirement、ADR、Issue、PR 和 Commit 如何归一，以及 Evidence 生命周期如何传播，要等 V0.1 的身份与版本模型稳定后再定义。
- 是否需要跨 Snapshot 的 Definition Lineage，以及重命名、移动、复制、拆分、合并和分支连续性如何表达，要等 P5/P6 的 Evidence 与 Capability 引用需求可观察后再定义。
- P6 的 Capability Candidate 生成、证据校验、人工接受/修改/合并/拒绝和稳定身份，需要 P5 Evidence Graph 形成后再拆票。
- P7 面向新员工、开发任务、架构评审和业务人员的认知分辨率及 Progressive Disclosure 交互，需要 Capability Graph 的真实规模和误差数据后再拆票。
- 多仓库关联、跨仓库契约、权限隔离和团队级远程图服务，等单仓库 V0.1 证明价值后再确定。

## Out of scope

- 本地图中的票据不负责实现、发布或部署 V0.1。
- V0.1 不制作 Web UI、全局 3D Graph 或 IDE 替代品。
- V0.1 不追求全语言支持、全量 DataFlow、Runtime Trace、自动重构或自动写文档。
- V0.1 不建立自有托管云服务，也不把私有、内部或敏感源码发送给外部服务；正式 Benchmark 仅对已冻结的公开开源 Corpus 使用现有 Codex。
- [研究正式 Benchmark 的本地 Agent 运行环境](issues/14-research-local-agent-runtime.md) — 研究结论保留作历史证据，但用户决定不部署或维护本地模型，因此该方案不进入实施路线。
