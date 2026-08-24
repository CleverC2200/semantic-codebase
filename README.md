# Semantic Codebase

Semantic Codebase 是从零实现的本地代码图谱项目，目标是把源代码转换为可查询、可追溯、绑定版本与证据的结构化软件认知模型。

本项目只使用一个顶层 Git 仓库。开发者可以在本地 `references/` 保存研究样本和实现参考；该目录整体忽略，不进入本项目的 Git 历史、公开仓库或运行时依赖。

```text
Semantic Codebase/
├── README.md
├── CONTEXT.md
├── .scratch/                       # 研究、决策与历史验收资料
├── references/                     # 本地研究资料，Git 忽略
│   ├── semantic-codebase/          # 早期 Slice 1 原型，作为参考保留
│   └── codegraph/                  # colbymchenry/codegraph 本地参考快照
└── src/、test/、docs/              # 后续自研实现从顶层逐步建立
```

## 项目边界

- 自研代码从项目顶层重新开始，不以 `references/semantic-codebase/` 为产品源码起点。
- 本地 `references/codegraph/` 可保存 CodeGraph 快照，用于学习抽取、解析、存储和查询的工程实现。
- 引用项目中的代码、依赖、Skill、构建产物和历史资料不能自动视为本项目设计或产品依赖。
- 引用项目的来源、基线和本地状态只在本地 `references/README.md` 维护，不随公开仓库发布。

## 现有资料

- [领域词汇与语义约束](CONTEXT.md)
- [Syntax Extraction Spec](docs/specs/syntax-extraction.md)
- [Semantic Codebase 总路线图](.scratch/semantic-codebase/map.md)
- [开源项目参考与采用状态](.scratch/semantic-codebase/research/open-source-reference-index.md)
- [早期 V0.1 实施交接](.scratch/semantic-codebase/v01-implementation-handoff.md)

`.scratch/semantic-codebase/` 中部分文件记录此前以早期原型作为产品实现的历史方案。当前项目边界以本 README 为准。
