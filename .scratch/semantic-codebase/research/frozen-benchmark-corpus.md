# V0.1 Benchmark Corpus 冻结清单

## 决策

V0.1 外部真实项目固定为 **Zod、Socket.IO、Poetry、Textual**；CodeGraph 自举固定为 `c6aaa20358cd6adcd04b87bdef8e5803ad146f3a`。所有题目、Gold 与运行记录只能引用下表中的完整 commit，不得改用分支、tag 名或当前工作树。

这份清单落实 [Benchmark Contract](../issues/04-decide-benchmark-contract.md) 的 4 个外部项目 × 8 题、12 个自举题以及 TypeScript/Python 分层；Fixture 在本票只冻结语义覆盖矩阵，不实现样例或题目。

## 取证方法与纳入门槛

- 只读取项目官方 GitHub 的 commit、Git tree、许可证、锁文件、`package.json`/`pyproject.toml` 和官方 CI；没有向外部服务发送本地源码、日志或工作树内容。
- “可索引文件”只计主源码根中的 `.ts`/`.tsx` 或 `.py`，排除 `test`、`tests`、`__tests__`、`fixtures`、`benchmarks`、`vendor`、`generated`、`dist`、构建缓存和二进制。统计来自冻结 commit 的递归 Git tree；比例是该可索引源码根内的文件数比例，而不是仓库网页的语言探测比例。
- 外部项目须有 OSI 许可、80–800 个可索引主语言文件、根锁文件、官方构建/测试入口，并同时能提供 Definition、导入/导出、跨文件调用和静态边界题材。题目仅从排除后源码生成。
- 本票验证的是**版本、依赖锁和官方可重放命令**；为遵守“不克隆大量仓库”，未在本机拉取四个外部仓库或执行其测试。因此“本地双冷启动通过”仍是运行器的入库前硬门槛，不能被本文件或 CI 成功替代。固定 commit 和清洁命令不变，失败则淘汰该项目而不是漂移到新版本。

## Corpus Manifest

| 层 / 角色 | 项目与冻结版本 | 许可与规模 | 锁定输入与官方重放命令 | 可用于的结构题材 |
| --- | --- | --- | --- | --- |
| TypeScript / 库 | [Zod `1fb56a5c18c27102dbc92260a4007c7732a0ccca`](https://github.com/colinhacks/zod/commit/1fb56a5c18c27102dbc92260a4007c7732a0ccca)（tag `v4.4.3`；tree `1eb96a1ab94c57a0abcbea3563f9b7ab8a0fe017`） | [MIT](https://github.com/colinhacks/zod/blob/1fb56a5c18c27102dbc92260a4007c7732a0ccca/LICENSE)；`packages/zod/src/` 中 107 个 TS/TSX 文件、1,023,234 bytes，主语言 107/107。 | [pnpm-lock.yaml](https://github.com/colinhacks/zod/blob/1fb56a5c18c27102dbc92260a4007c7732a0ccca/pnpm-lock.yaml) SHA-256 `1abf4a72b7996d455ea922a79356364c7f0653cdde506b851475242c93f96e66`；[package.json](https://github.com/colinhacks/zod/blob/1fb56a5c18c27102dbc92260a4007c7732a0ccca/package.json) 固定 `pnpm@10.12.1`，命令 `corepack pnpm install --frozen-lockfile && pnpm build && pnpm test`；[CI](https://github.com/colinhacks/zod/blob/1fb56a5c18c27102dbc92260a4007c7732a0ccca/.github/workflows/test.yml) 实际执行 build/test。 | schema 与类型 Definition、模块 export/import、re-export、parse/validation 跨文件调用、泛型/运行时动态边界。 |
| TypeScript / 多包服务 | [Socket.IO `9978574e4f1d4e21593497f94c40053cd0fff359`](https://github.com/socketio/socket.io/commit/9978574e4f1d4e21593497f94c40053cd0fff359)（tag `socket.io@4.8.3`；tree `b06ccd031ee67c2084e979b9ceaab2654eba70b7`） | [MIT](https://github.com/socketio/socket.io/blob/9978574e4f1d4e21593497f94c40053cd0fff359/LICENSE)；递归 tree 有 178 个 TS/TSX，排除测试后 `packages/` 有 129 个可索引 TS/TSX 主源码，主语言 129/129。 | [package-lock.json](https://github.com/socketio/socket.io/blob/9978574e4f1d4e21593497f94c40053cd0fff359/package-lock.json) v3、SHA-256 `fa5767c359a9aecdc09dbc1d9c26aca09a113474606c9545e007902bcec10148`；[官方 CI](https://github.com/socketio/socket.io/blob/9978574e4f1d4e21593497f94c40053cd0fff359/.github/workflows/ci.yml#L59-L66) 的 Node 20/22 命令 `npm ci && npm run compile --workspaces --if-present && npm test --workspaces`。 | server/client/parser 包边界、export/import、类/接口、跨 workspace 调用与事件路径；动态 event 名称只能进入 L3 拒答题。 |
| Python / CLI 应用 | [Poetry `811a12dae0fe81f199e3f1b88b8b8be9eed543c2`](https://github.com/python-poetry/poetry/commit/811a12dae0fe81f199e3f1b88b8b8be9eed543c2)（tag `2.4.1`；tree `5547ee28d49eed24b070c7f38427a294dfb4744d`） | [MIT](https://github.com/python-poetry/poetry/blob/811a12dae0fe81f199e3f1b88b8b8be9eed543c2/LICENSE)；`src/poetry/` 中 191 个 Python 文件、904,892 bytes，主语言 191/191。 | [poetry.lock](https://github.com/python-poetry/poetry/blob/811a12dae0fe81f199e3f1b88b8b8be9eed543c2/poetry.lock) SHA-256 `49cae1327857aad71c12d49914e3e8c9bd9e45cc7160fcdec2513fdcb79e9cbe`；[pyproject](https://github.com/python-poetry/poetry/blob/811a12dae0fe81f199e3f1b88b8b8be9eed543c2/pyproject.toml) 要求 Python `>=3.10,<4.0`；官方测试工作流以 `poetry install --only main,test` 安装并运行 pytest，清洁复放命令为 `poetry install --only main,test && poetry run pytest`。 | 命令/handler Definition、包导入、Application 到 Command/Installer 的跨目录调用、类继承与抽象基类、可解析与动态 plugin 边界。 |
| Python / TUI 框架 | [Textual `1d99508b928a771b51e1a527319c6b87dcff9e05`](https://github.com/Textualize/textual/commit/1d99508b928a771b51e1a527319c6b87dcff9e05)（tag `v8.2.8`；tree `819d610a9ff86fd8f2f7b85f80a14bf827fe4286`） | [MIT](https://github.com/Textualize/textual/blob/1d99508b928a771b51e1a527319c6b87dcff9e05/LICENSE)；`src/textual/` 中 247 个 Python 文件、2,761,339 bytes，主语言 247/247。 | [poetry.lock](https://github.com/Textualize/textual/blob/1d99508b928a771b51e1a527319c6b87dcff9e05/poetry.lock) SHA-256 `087a89a9c9cda3af13ec9344b1a52346f31177911abbdc993ff1643a8c0f4a7b`（另有 [uv.lock](https://github.com/Textualize/textual/blob/1d99508b928a771b51e1a527319c6b87dcff9e05/uv.lock) SHA-256 `50e8bd1f687fc71872a80b9921fb9e4cab9906a892b5251b7945dd1305735656`）；[官方 CI](https://github.com/Textualize/textual/blob/1d99508b928a771b51e1a527319c6b87dcff9e05/.github/workflows/pythonpackage.yml#L29-L48) 使用 Poetry 1.7.1、Python 3.9–3.14，命令 `poetry install --no-interaction --extras syntax && poetry run pytest tests -v`（Python 3.10+）。 | App/Widget/Message Definition、包导入、继承/override、消息分派跨文件关系；反射式 selector/动态回调只作为 L3 边界。 |
| 自举 | [CodeGraph `c6aaa20358cd6adcd04b87bdef8e5803ad146f3a`](https://github.com/colbymchenry/codegraph/commit/c6aaa20358cd6adcd04b87bdef8e5803ad146f3a)（tree `3cc5aaa3c695d863c2cca5e4e5bf121f9b537549`） | [MIT](https://github.com/colbymchenry/codegraph/blob/c6aaa20358cd6adcd04b87bdef8e5803ad146f3a/LICENSE)；`src/` 中 179 个 TS/TSX、3,501,387 bytes，主语言 179/179。当前本地 checkout 有 38 项既有变更，故不能充当自举输入。 | `package-lock.json` v3，SHA-256 `a587f864facdc9613b0fc5053e542766daab654104defb6f4fc743a68929c008`；[package.json](https://github.com/colbymchenry/codegraph/blob/c6aaa20358cd6adcd04b87bdef8e5803ad146f3a/package.json) 规定 Node `>=20,<25`、`npm run build`、`npm test`。清洁复放命令 `npm ci && npm run build && npm test`。 | CLI/MCP 入口、抽取、SQLite 存储、解析与图查询的跨模块路径；仅问该提交静态支持的关系，不把 README/测试名当答案。 |

完整递归 tree 是规模统计的一手输入：[​Zod](https://api.github.com/repos/colinhacks/zod/git/trees/1eb96a1ab94c57a0abcbea3563f9b7ab8a0fe017?recursive=1)、[​Socket.IO](https://api.github.com/repos/socketio/socket.io/git/trees/b06ccd031ee67c2084e979b9ceaab2654eba70b7?recursive=1)、[​Poetry](https://api.github.com/repos/python-poetry/poetry/git/trees/5547ee28d49eed24b070c7f38427a294dfb4744d?recursive=1)、[​Textual](https://api.github.com/repos/Textualize/textual/git/trees/819d610a9ff86fd8f2f7b85f80a14bf827fe4286?recursive=1)。锁文件 hash 是上述冻结文件原始字节的 SHA-256。

## 题目配额与生成规则

每个外部项目 8 题，且每项目至少包含 L0、L1、L2、L3 各一题；剩余 4 题用其最强的静态关系补足。每种语言合计 16 题时，至少各有：4 个 L0、5 个 L1、5 个 L2、2 个 L3。CodeGraph 自举层固定 12 题，按 CLI/MCP → extraction → db → resolution/graph 的真实路径取样。题面、Gold、证据锚点和隐藏审核材料仍按 Benchmark Contract 的隔离规则另存，不写入项目 checkout。

## Fixture 结构语义矩阵

| 语义 / 边界 | TS Fixture A | TS Fixture B | Python Fixture A | Python Fixture B | 外部项目中的复核点 |
| --- | --- | --- | --- | --- | --- |
| Definition 定位 | function、class、interface、method、module export | 同名遮蔽的局部/导出 Definition | function、class、method、module | 同名局部、包级与实例属性 Definition | 每个项目至少一题 L0。 |
| 导入、导出与别名 | named/default export、import alias | barrel re-export、path alias | `import`、`from … import … as` | package `__init__` re-export、相对导入 | 每个项目至少一题精确集合。 |
| 一跳调用 | 静态函数/方法调用 | 构造后方法调用与 callback 参数 | 直接函数/实例方法调用 | `super()` 与 classmethod/staticmethod | 端点与 Evidence 必须可静态定位。 |
| 跨文件路径 / 影响面 | 入口 → service → repository 两跳 | export → consumer → sink 两跳 | CLI → command → service 两跳 | app → message handler → widget 两跳 | 每种语言至少一条 L2 正例。 |
| 类型与继承 | `extends`、`implements`、interface conformance | abstract class、override | base class、ABC、override | mixin/多继承的可确认子集 | 不把结构不支持的 duck typing 伪装为确定边。 |
| L3 拒答 | computed property、dynamic import、运行时反射 | unresolved alias / 条件模块加载 | `getattr`、动态 import、monkey patch | decorator 注入、插件发现 | 输出 `insufficient_static_evidence`，不得猜测。 |

## 排除与淘汰

### 通用排除规则

1. 不索引依赖目录、vendored/第三方镜像、压缩或已生成产物、编译输出、二进制、覆盖率报告、文档构建产物及测试/fixture/benchmark；它们不能成为题面或 Gold Evidence。
2. 仅题目显式考察的同一固定 commit 可被 checkout；不读取 `.git` 历史、Issue、PR、README、隐藏 Gold 或评测日志来回答问题。
3. 任何锁文件 hash、运行时、`npm ci`/`pnpm --frozen-lockfile`/`poetry install` 双冷启动或原生测试失败，均阻断该项目入正式分数；替换必须开新研究票并重新冻结，不修改本 manifest 的 commit。

### 淘汰候选

| 候选 | 证据 | 淘汰原因 |
| --- | --- | --- |
| [Nest `4535f43b4890c9c69c57c5a5a8b49f62c83d1ed6`](https://github.com/nestjs/nest/commit/4535f43b4890c9c69c57c5a5a8b49f62c83d1ed6)（tag `v11.2.1`） | 冻结 commit 的官方递归 Git tree 统计 1,684 个 TS 文件。 | 超过 80–800 可索引文件上限；即使 MIT、根 `package-lock.json` 和测试入口齐备，也不纳入 V0.1。 |
| [VitePress `1fc537b78cda287fa23c1129a815ad9455fd8106`](https://github.com/vuejs/vitepress/commit/1fc537b78cda287fa23c1129a815ad9455fd8106)（tag `v1.6.4`） | [源码归档](https://codeload.github.com/vuejs/vitepress/tar.gz/1fc537b78cda287fa23c1129a815ad9455fd8106) 中 `src/` 排除测试/fixtures 后仅 72 个 TS/TSX。 | 小于 80 文件下限，无法提供足够多的独立题材；不以降低阈值迁就候选。 |

## 交接清单

1. 运行器从此 manifest 读取 URL、commit、完整锁 hash、运行时与排除规则；checkout 后先验证 `HEAD`、tree 和锁文件 SHA-256。
2. 在隔离、无网络的评测镜像制作前，以网络受控的构建阶段按表中原生命令对每个项目连续跑两次；记录容器 digest、安装日志摘要、测试退出码与环境 hash。
3. 仅在四个外部项目全部通过、Gold 完成双人审核且 Agent 挂载不含 Gold 后，生成 32 道外部题并进入 Release Benchmark。
