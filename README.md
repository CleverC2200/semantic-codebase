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

当前能力和剩余缺口见 [语义补齐执行记录](docs/receipts/final-diff-review-2026-09-06.md)。`complete` Coverage 表示该轮文件分析完成，不等于所有语义、调用和业务路径均已识别；必须同时检查每条事实的 unknown、来源等级和预算截断。

使用 Node 24 和锁文件安装完整开发依赖后，可先用仓库自带 Python 语料试用，无需研究样本：

```bash
npm ci
npm run demo:local
```

已有本地 `references/zod/` 冻结语料时，`npm run preview:semantic` 同时展示 Zod TypeScript、Python/Pyright、冻结 OTLP Trace、Capability Candidate 和本地中文 Evidence Answer。它的 Gold 是输出指纹回归，不是独立准确率验收。

TypeScript grammar 当前使用锁定的上游未合并提交及本地兼容补丁，以支持 Zod v4 的 `in/out` 类型参数，同时保留普通参数名 `out`。`npm install` / `npm ci` 的 `postinstall` 会生成 ABI 14 parser 并编译原生绑定；开发安装需要完整 devDependencies、Python、C/C++ 编译工具和 make（macOS 可用 Xcode Command Line Tools）。不支持跳过安装脚本后直接运行，也尚未验证 `--omit=dev` 部署安装。手动恢复命令为 `npm run prepare:grammar`。源码不会被预处理或改写；升级后请用 `sync` 重建旧索引。详见 [grammar 兼容性验证记录](docs/receipts/final-diff-review-2026-09-06.md)。

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

该开关会创建一次临时、只读、非持久化 Codex 调用。正式 `summary/findings` 由本地事实确定性渲染；模型文案单独放在 `presentation`，标记 `llm_inferred` 和 `verified: false`，不能覆盖权威结论。默认命令不调用 Codex。调用前须明确允许本次问题与裁剪内容外传。

对任意本地仓库使用 CLI：

```bash
npm run scb -- index --repo /path/to/repository --store /path/to/preview.sqlite
npm run scb -- semantic build --repo /path/to/repository --store /path/to/preview.sqlite
npm run scb -- semantic facts --repo /path/to/repository --store /path/to/preview.sqlite --file-path src/main.ts
npm run scb -- context ask --repo /path/to/repository --store /path/to/preview.sqlite --question "main.ts 的入口主线是什么？" --file-path src/main.ts
```

预览生成后，可对本地公开 Zod 样例执行一次真实运行观测验证（不调用 Codex，不运行任意用户仓库）：

```bash
npm run capture:zod
```

真实 Trace、观测和收据位于 `.workspace/acceptance/semantic-runtime/`；默认预览中的冻结 Trace 仍是导入测试样例，两者不可混淆。

人工确认能力候选使用 `capability accept/reject/merge/list`。先用 `runtime import` 取得候选 ID，再明确确认；本命令不会自动替用户接受业务能力：

```bash
npm run scb -- capability accept --repo /path/to/repository --store /path/to/preview.sqlite --trace /path/to/trace.json --candidate-id CANDIDATE_ID --actor REVIEWER --reason "已核对源码与观测" --title "能力名称"
npm run scb -- capability list --repo /path/to/repository --store /path/to/preview.sqlite
```

后续修改需指定 `--expected-version`；合并另需 `--into-id`。SQLite 的 `capability_decisions`、`capability_decision_events`、`capability_observation_sets` 分别保存当前决定、历史版本和观测证据。`merged_into` 保留合并关联，旧快照记录会显示 `stale`，不是自动跨版本确认。

### 2026-09-05 补齐版本

一次构建结构与语义，后续 `sync` 自动为新快照重建已有语义层（当前不是按函数增量计算语义）：

```bash
npm run scb -- index --profile semantic-v0 --repo /path/to/repository --store /path/to/new-preview.sqlite
npm run scb -- sync --repo /path/to/repository --store /path/to/new-preview.sqlite
```

已有不可变 Overlay 不会被新版 Profile 覆盖；`sync --profile semantic-v0` 将当前语义引擎版本纳入新 Snapshot 身份，在同一个 SQLite 中保留旧结果并生成新版结果。旧库请先 sync，再执行 semantic build。

`context ask` 支持能力、功能实现／入口流程、调用路径、数据流、条件异常副作用、影响范围六类旅程，以及文件概览。MCP `semantic_codebase_ask` 使用同一离线实现，不调用模型、不写数据库。人工接受／合并的能力会通过该查询链路消费，并排除旧快照决定。

将真实采集结果用于预览：

```bash
npm run capture:zod
npm run preview:semantic -- --trace=.workspace/acceptance/semantic-runtime/trace.otlp.json
```

自带 Gold 文件仍只承担固定输出回归；`--print-regression-gold` 只打印当前回归指纹，不是独立正确性验收。传入其他 Trace 时只复用静态部分回归比较，运行观测必须单独审查。

当前仍是有界、部分覆盖的 V0，不代表任意代码的业务语义均可理解。完整结果、未完成项和门禁见 [本轮执行回执](docs/receipts/final-diff-review-2026-09-06.md)。

### 连续补齐版本：先跑本地效果

```bash
npm run demo:local
node dist/cli/main.js ask --repo benchmark/corpus/python --store .workspace/acceptance/current-v0/python.sqlite --question "build_registry 的调用路径" --format markdown
npm run verify:semantic-release
node scripts/prepare-release-review.mjs
```

`demo:local` 生成 `.workspace/acceptance/current-v0/answer.md`、`answer.json` 和 `python.sqlite`，不调用模型、不运行被索引代码。`ask` 是 `context ask` 的别名，Markdown 与 JSON 消费相同证据；无法识别的问题或歧义目标会明确报错。

TS 配置支持冻结的根配置、仓库内 extends/paths、项目 references、package.json 与声明文件。Python 配置支持 `pyrightconfig.json`、仓库内 extends、extraPaths、executionEnvironments、版本/平台设置与冻结的 .pyi；不会使用未冻结的宿主虚拟环境。任意依赖配置继承、pyproject.toml 和完整安装环境仍未覆盖。

只有显式 `trace run` 执行命令。被执行程序需自行向 `SCB_TRACE_OUTPUT` 写入 OTLP JSON，并可用 `SCB_SNAPSHOT_ID` 绑定来源；这不是自动插桩器或安全沙箱：

```bash
node dist/cli/main.js trace run --repo /path/to/repository --store /path/to/store.sqlite --timeout-ms 30000 -- /path/to/instrumented-command arg1
```

命令回执保留退出状态、目录、平台/Node 版本摘要、耗时和输出摘要，不返回原始命令日志；无 Trace、损坏 Trace、超时或源码变化均不会伪造成功观测。macOS/Linux 清理本次进程组，Windows 仅支持直接子进程终止，未验收。

跨快照能力复核使用 `capability revalidate`，明确指定 `--capability-id`、新 Trace 的 `--candidate-id`、`--expected-version`、`--actor`、`--reason`。不会按名称自动迁移人工决定。

`--codex` 仍为显式外发选项：仅发问题、定义名称与证据摘要；附 Provider Invocation Receipt，限制超时并禁用执行、浏览、插件等工具入口，响应格式错误或服务不可用时保留离线事实。工具禁用依照 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。当前已有一次真实模型输出、格式和零工具活动证据；两条已知启动提示已离线精确分类，但尚未用新的真实调用完整复验 `completed_with_warnings`。模型表述始终标为未验证推断，不升级为权威事实。

54 道题和 6 道对照查询结果位于 `.workspace/acceptance/release-review/`；实现方生成的核对包不等于独立 Gold。2026-09-05 的独立复核和临时通过仅为历史结果。2026-09-06 完整 diff 审查修复了值传播和 Trace 读取问题，当前输出已变化，发布暂不放行；需复核变化的独立判分，详见 [本次审查与交付记录](docs/receipts/final-diff-review-2026-09-06.md)。原 150/75 ms 延迟目标继续作为非阻塞优化项；临时预算仍为 300/150 ms，RSS 196608 KiB。
