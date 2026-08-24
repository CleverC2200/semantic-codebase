# TypeScript 与 Python 抽取 Adapter 路线研究

> 范围：只讨论 V0.1 的 Definition / Relation 确定事实。结论基于 CodeGraph、SCIP、各语言 SCIP indexer、Tree-sitter 与 LSP 的官方仓库、规范或源码；不把本地仓库内容发送给任何服务。本文不是许可证法律意见。

## 结论

V0.1 应把 **Tree-sitter 语法抽取**作为 TypeScript 与 Python 的共同、内建基线：它确定地产生 CST、位置和语法结构，并且可在编辑后增量重解析。持久化层仍应把“受影响文件的完整重抽取 + 文件内容哈希 / grammar 版本”作为原子增量单位；不要把 Tree-sitter 的内存 edit 结果当作跨进程或跨版本的索引增量协议。

**SCIP 应是可选的批处理语义富集 Adapter，而非共同基线。** 它提供稳定、可消费的定义/引用位置、symbol 与 role 格式；TypeScript 的 `scip-typescript` 可作为 P0/P1 实验的首选富集来源，Python 的 `scip-python` 只列为实验性可选来源，因其运行依赖 Python 3.10+、Node、激活的环境及 `pip` 或显式环境清单。两者都应按“生成完整 `index.scip` 快照 → 消费 → 以仓库版本验证并合并”的离线作业处理，不能承诺 editor 级增量。

**CodeGraph 不作为 V0.1 运行时抽取 Adapter。** 它已具备嵌入 API、本地 SQLite、原生文件事件增量同步以及 TypeScript/Python Tree-sitter 路径，适合做实现参考和 P0 benchmark 对照；但其公开 API 是自己的图查询/上下文产品，V0.1 不应把自身的 Canonical IR、版本、完整性或验收绑定到其内部图模型。LSP 也不进入 V0.1 的离线权威路径：它规范的是编辑器与语言服务器之间的 JSON-RPC 会话，而不是可复现的仓库索引格式。

## 能力边界与决策

| 来源 | 能确定的事实 | 精度边界 | 增量与运行约束 | V0.1 决策 |
| --- | --- | --- | --- | --- |
| Tree-sitter + TS/Python grammar | CST、节点种类、命名节点文本及字节/行列范围；官方定位是“parser generator + incremental parsing library”。[官方介绍](https://tree-sitter.github.io/tree-sitter/) | 这是语法事实，不是类型检查或跨文件绑定；“不把同名标识符误连”为语义需求，不能由 CST 单独证明。 | Parser 可在编辑后高效更新树；持久索引以变更文件全量重新抽取、删除旧 file slice、写入新 file slice 实现。 | **必选基线 Adapter**；输出 `definition_candidate`、`contains`、`imports`、`call_candidate`，每条带 source range 与 `syntax` evidence。 |
| SCIP | `Occurrence` 把源码位置与 symbol / role 关联；schema 提供 Document、SymbolInformation、签名、文档与诊断，目标是 definition/reference/implementation 导航。[SCIP 总览](https://github.com/scip-code/scip)；[Occurrence schema](https://github.com/scip-code/scip/blob/main/docs/scip.md#occurrence) | 精度取决于具体 indexer 的编译器/分析器和项目环境；SCIP 统一输出格式，不保证任一语言所有动态关系都可解析。 | 规范描述完整 index 及其 Document，不定义文件编辑 delta 或 watch 协议；因此按 indexer 快照导入并以 `repo_revision + content_hash` 拒绝过期结果。 | **可选语义富集 Adapter**；只提升已验证定义/引用的 confidence，绝不覆盖基线语法证据。 |
| `scip-typescript` | 官方列出的 TypeScript/JavaScript SCIP indexer；从项目根的 `tsconfig.json` 索引，依赖 TypeScript 编译器；JS 可 `--infer-tsconfig`，建议配 `@types/*` 改善质量。[README](https://github.com/sourcegraph/scip-typescript/blob/main/README.md) | TypeScript 项目配置和安装依赖是解析/解析模块边界的前提；未配置、失败解析或跳过文件必须作为 coverage/evidence 状态，而不是“无关系”。 | 官方 README 当前支持 Node 18/20；大项目可能 OOM，global cache 可用内存换速度。[README：运行与 OOM](https://github.com/sourcegraph/scip-typescript/blob/main/README.md#dealing-with-out-of-memory-issues-oom) | **第一个可实现的 SCIP enrichment**；子进程离线生成 `index.scip`，读取 Protobuf，记录 indexer / TypeScript / tsconfig fingerprint。 |
| `scip-python` | Sourcegraph 明确说明它是“聚焦生成 Python SCIP 的 Pyright fork”，且对 Pyright 本体改动很少。[仓库说明](https://github.com/sourcegraph/scip-python/tree/scip) | 其定义/引用精度依赖 Pyright 对 import、解释器与第三方包环境的可见性；不能把缺少环境时的缺失当作确定的未引用。 | Python 3.10+、Node v16+；默认借助 `pip` 推断环境，或用 `--environment` 传入包清单；需要激活虚拟环境。[运行要求与环境](https://github.com/sourcegraph/scip-python/blob/scip/README.md#pre-requisites) | **实验性可选 enrichment**；默认要求调用者传经审计的 `--environment`，禁止 V0.1 自动安装依赖或上传产物。达到 benchmark 门槛后才升为默认。 |
| CodeGraph | 官方 README 说明其用 Tree-sitter 提取函数/类/方法及 call/import/extends/implements，写入本地 SQLite，随后解析引用，并以 OS 文件事件增量同步；也公开 `CodeGraph` 嵌入 API。[架构与 API](https://github.com/colbymchenry/codegraph/blob/main/README.md#how-it-works) | 它的 node/edge 语义、resolver 规则、版本和完整性状态均属于其产品；其 MCP 主工具返回面向 Agent 的源码上下文而非 V0.1 的原始抽取 IR。 | 嵌入要求 Node 22.5+；有自己的 SQLite 生命周期、watcher 与版本管理。[嵌入约束](https://github.com/colbymchenry/codegraph/blob/main/README.md#library-usage) | **实现参考 + P0 benchmark 对照**；可以用隔离的 comparison harness 比较 coverage/precision，不接入 Canonical IR 的权威写入路径。 |
| LSP | LSP 标准化编辑器/IDE 与语言服务器的 JSON-RPC 通信，提供 definition、references 等语言特性；其首页将 LSIF/索引格式与 LSP 会话区分。[协议概览](https://microsoft.github.io/language-server-protocol/) | 是否支持某请求、结果完整性和语义均由具体服务器与其工作区状态决定；协议本身不把任意服务器结果变成离线、版本绑定的事实库。 | 需要管理 server 进程、初始化选项、工作区、依赖解释器以及未保存 buffer 的版本；适合交互查询，不是可重放批索引。 | **不纳入 V0.1 权威抽取**；可在后续作为诊断/人工比较 Adapter，结果只能是临时 evidence。 |

## 推荐的 Adapter 契约

```text
SourceSnapshot(repo_revision, relative_path, content_hash, language, bytes)
  -> SyntaxAdapter.extract(snapshot)
  -> ExtractionSlice(definitions, structural_relations, unresolved_candidates, evidence)

RepoSnapshot(repo_revision, source_manifest, toolchain_fingerprint)
  -> ScipBatchEnrichmentAdapter.index(snapshot)
  -> SemanticSlice(definition_occurrences, reference_occurrences, symbol_information, coverage)
```

必须遵守以下规则。

1. `SyntaxAdapter` 对每个 `SourceSnapshot` 独立、可重跑；定义候选的稳定身份由规范化仓库相对路径、语法 kind、名称、范围和内容版本组成，**不是** Tree-sitter node object identity。
2. `ScipBatchEnrichmentAdapter` 只能接受已冻结的 manifest；导入前验证 index 中 document path 与本地 `content_hash`，不匹配即标记 `stale`，不合并。
3. relation 的 provenance 至少区分 `syntax`、`scip`、`lsp-ephemeral`。语法 call 只能是 `call_candidate`；只有经 SCIP symbol/role 或同一套可审计绑定规则验证后才能升级为 resolved reference。
4. 删除、解析失败、跳过过大文件、缺失 grammar、SCIP indexer 失败和环境不完整都必须留 coverage 状态，不能静默归约为 0 个定义或 0 条边。
5. 增量运行只重建变更文件的 Syntax slice；SCIP 由工作区批 job 触发。两者写入前都检验同一 `repo_revision`，避免把不同工作树/依赖环境的事实混入。

## 集成顺序与验收门槛

1. 先实现 TypeScript/Python 共用的 Tree-sitter `SyntaxAdapter`，以手工金样本验收 declaration、嵌套 containment、显式 import、call candidate 和精确范围。
2. 加入 `scip-typescript` 的隔离 batch runner，只在固定 `tsconfig.json`、锁定依赖和冻结工作树上运行；对金样本报出“SCIP 已解析 / 语法候选 / 未覆盖”的三态。
3. 把 `scip-python` 放到同一 runner 的 feature flag 后，要求 `--environment` 或已验证的 venv；只有在 Python corpus 的定义/引用覆盖、失败可解释性和资源门槛均通过后，才改变默认。
4. 用 CodeGraph 在同一 corpus 上作对照：比较每文件 definitions、显式 imports、resolved call/reference 的 precision/recall 与增量后结果一致性；只记录差异与证据，不以其图结果取代自有模型。

## 许可证与交付边界

- Tree-sitter core、`tree-sitter-typescript` 与 `tree-sitter-python` 均为 MIT；若分发其 runtime、grammar、生成物或复制实质代码，应保留相应版权/许可证文本。[core](https://github.com/tree-sitter/tree-sitter/blob/master/LICENSE)；[TypeScript grammar](https://github.com/tree-sitter/tree-sitter-typescript/blob/master/LICENSE)；[Python grammar](https://github.com/tree-sitter/tree-sitter-python/blob/master/LICENSE)
- SCIP 协议仓库与 `scip-typescript` 为 Apache-2.0；若复制/再分发其代码、schema 生成物或 NOTICE，应按 Apache-2.0 的 notice / license 要求随交付物审计。`scip-typescript` 的 package manifest 还明确依赖 TypeScript 5.6.2。[SCIP LICENSE](https://github.com/scip-code/scip/blob/main/LICENSE)；[indexer manifest](https://github.com/sourcegraph/scip-typescript/blob/main/package.json)
- `scip-python` 的其分支 `LICENSE.txt` 为 MIT（版权文本标明 Pyright）；CodeGraph 为 MIT。[scip-python LICENSE](https://github.com/sourcegraph/scip-python/blob/scip/LICENSE.txt)；[CodeGraph LICENSE](https://github.com/colbymchenry/codegraph/blob/main/LICENSE)
- “启动一个已安装的 CLI”与“复制/静态链接/分发其代码或 grammar”是不同交付行为。本路线优先子进程 + 自有 Protobuf consumer，并为任何打包的第三方 artifact 建 `THIRD_PARTY_NOTICES` 清单；最终商业发布前由法务按实际分发物复核。

## 一手来源索引

- [SCIP 官方仓库与 indexer 列表](https://github.com/scip-code/scip)
- [SCIP Protobuf / Occurrence 文档](https://github.com/scip-code/scip/blob/main/docs/scip.md)
- [scip-typescript 官方仓库](https://github.com/sourcegraph/scip-typescript)
- [scip-python 官方仓库（scip 分支）](https://github.com/sourcegraph/scip-python/tree/scip)
- [Tree-sitter 官方文档](https://tree-sitter.github.io/tree-sitter/)
- [LSP 官方规范入口](https://microsoft.github.io/language-server-protocol/)
- [CodeGraph 官方仓库](https://github.com/colbymchenry/codegraph)
