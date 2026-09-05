# Semantic Codebase

Semantic Codebase 是从零实现的本地代码图谱项目，目标是把源代码转换为可查询、可追溯、绑定版本与证据的结构化软件认知模型。

本项目只使用一个顶层 Git 仓库。开发者可以在本地 `references/` 保存研究样本和实现参考；该目录整体忽略，不进入本项目的 Git 历史、公开仓库或运行时依赖。

```text
Semantic Codebase/
├── README.md
├── CONTEXT.md
├── .scratch/                       # 研究、决策与历史验收资料
├── references/                     # 本地研究资料，Git 忽略
│   ├── zod/                        # 冻结的 TypeScript 真实项目测试语料
│   └── codegraph/                  # colbymchenry/codegraph 本地参考快照
└── src/、test/、docs/              # 后续自研实现从顶层逐步建立
```

## 项目边界

- 自研代码位于项目顶层，`references/` 中的项目不是产品源码。
- 本地 `references/zod/` 固定为 Zod `1fb56a5c18c27102dbc92260a4007c7732a0ccca`；当前以其 13 文件的 `packages/zod/src/v3/` 作为快速 smoke，完整 107 文件作为后续 grammar 兼容与性能门禁。
- 本地 `references/codegraph/` 可保存 CodeGraph 快照，用于学习抽取、解析、存储和查询的工程实现。
- 早期 Slice 1 原型已从 `references/` 退役；历史行为以验收收据为准，必要时可从本地发布前 Git bundle 恢复。
- 引用项目中的代码、依赖、Skill、构建产物和历史资料不能自动视为本项目设计或产品依赖。
- 引用项目的来源、基线和本地状态只在本地 `references/README.md` 维护，不随公开仓库发布。

## 现有资料

- [领域词汇与语义约束](CONTEXT.md)
- [Syntax Extraction Spec](docs/specs/syntax-extraction.md)
- [Structural Graph Productization Spec](docs/specs/structural-graph-productization.md)
- [Semantic Codebase 总路线图](.scratch/semantic-codebase/map.md)
- [开源项目参考与采用状态](.scratch/semantic-codebase/research/open-source-reference-index.md)
- [早期 V0.1 实施交接](.scratch/semantic-codebase/v01-implementation-handoff.md)

`.scratch/semantic-codebase/` 中部分文件记录此前以早期原型作为产品实现的历史方案。当前项目边界以本 README 为准。

## Zod 本地 smoke

`references/zod/` 存在时，可生成一份可查看、可复核的 Zod v3 代码图谱：

```bash
npm run corpus:zod
```

生成物位于已忽略的 `.workspace/benchmark/zod/`：

- `summary.md`：人工阅读的指标和 Definition/Relation 样例。
- `receipt.json`：语料版本、Manifest、运行环境和生成物哈希。
- `snapshot.json`：完整的机器可读 IndexState 和 Canonical Graph。

## Semantic V0 可运行预览

安装依赖后，一条命令同时运行 Zod TypeScript、Python/Pyright、冻结 OTLP Trace、Capability Candidate 和本地中文 Evidence Answer：

```bash
npm install
npm run preview:semantic
```

生成物位于 `.workspace/acceptance/semantic-preview/`：

- `acceptance.html`：面向人工检查的中文预览页；
- `preview.sqlite`：结构图与语义 Overlay 的原始 SQLite 数据；
- `semantic-overlay.json`：Zod TypeScript 语义结果；
- `python-semantic-overlay.json`：Python/Pyright 语义结果；
- `runtime-observations.json`：冻结 Trace 的运行时观测和能力候选；
- `context-package.json`、`evidence-answer.json`：受控上下文和本地模板答案；
- `inspect-semantic.sql`：可直接在 SQLite 控制台执行的查询示例；
- `receipt.json`：版本、Coverage、Gold 和资源预算收据。

需要 Codex 只润色已经生成并锁定证据的中文答案时，显式运行：

```bash
npm run preview:semantic -- --codex
```

该开关会创建一次临时、只读、非持久化 Codex 调用，只允许改写摘要和既有结论文本；Fact、Evidence、Coverage、unknown 与权威等级仍由本地 Validator 固定。默认命令不调用 Codex。

对任意本地仓库使用 CLI：

```bash
npm run scb -- index --repo /path/to/repository --store /path/to/preview.sqlite
npm run scb -- semantic build --repo /path/to/repository --store /path/to/preview.sqlite
npm run scb -- semantic facts --repo /path/to/repository --store /path/to/preview.sqlite --file-path src/main.ts
npm run scb -- context ask --repo /path/to/repository --store /path/to/preview.sqlite --question "main.ts 的入口主线是什么？" --file-path src/main.ts
```
