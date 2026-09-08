# 来源修正与扩展索引 · 2026-09-08

已修正样本收据冒用父仓库 HEAD 的问题，同时修复抽象类漏抽取导致的结构准入失败。旧冻结产物保留，勘误已写入上一轮验收记录；不回写 Snapshot / Overlay。

来源收据现在先核对 git --show-toplevel 的真实路径是否等于样本根目录。仅吻合时记录 Git HEAD 和状态；否则标 directory_snapshot，source_head/source_status 为 null，记录 enclosing_repository 或 git_unavailable，内容身份仍由 manifest_hash 和逐文件 digest 给出。公开入口回归测试覆盖父仓库嵌套目录、非 Git 目录、真实 Git 根目录：修复前 2/2 失败，修复后 2/2 通过。

全量诊断明确为三类原因：

- abstract_class_declaration 未被 Definitions Query 捕获，IMPLEMENTS 源错误退化为 source_file，触发 invalid_relation_endpoints。增加抽象类捕获后，最小 RepositoryIndexer 回归从失败转为 Ready；原文件 src/mcp/transport.ts 已准入。
- src/db/queries.ts：比较表达式中的 unique 标识符被当前 grammar 误判（最小复现 `for(let i=0;i<unique.length;i++) {}`）。
- src/resolution/callback-synthesizer.ts、src/telemetry/index.ts：字符串含实际 NUL 字节，当前 grammar 报 syntax_error。

后两类没有通过改写样本、忽略错误或放宽 Ready 门禁绕过。本轮不升级或替换全局 grammar，完整 179 文件仍未通过。修复抽象类后，明确排除上述 3 文件的 176 文件范围成功发布 Ready Snapshot，Semantic Overlay 与业务分组仍保持 partial。

| 样本 | 文件 | 结构归属定义 | 职责建议 | 未知关联 | 单次分组耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| CodeGraph | 176 | 2280 | 121 | 12078 | 1543 ms |
| Poetry | 192 | 1378 | 119 | 5317 | 86 ms |

两份新 source receipt 均为 directory_snapshot / enclosing_repository / source_head=null / source_status=null。Poetry Snapshot 与 Overlay 哈希和上一轮一致；TypeScript Query 变更通过 adapter profile 自动产生新 Snapshot，未沿用旧版本事实。

新产物分别位于 .workspace/acceptance/grouping-codegraph-176-20260908（分析）、grouping-codegraph-20260908（分组）、grouping-poetry-source-20260908（分析）、grouping-poetry-20260908（分组）。内容哈希与 Node / profile / 工具摘要在各 receipt.json 中。没有调用模型、执行样本项目或业务写入；这些是本地静态验收结果，建议数不代表业务分类准确率。

复现 176 文件范围可使用 [明确范围清单](grouping-inputs/codegraph-176.json) 与公开 run-source-reader / run-reader-grouping 入口；排除文件及原因必须随范围保留。旧 4 文件清单继续用于小范围回归。

验证：隔离的待提交树构建及全量测试 255/255 通过；语法/关系/增量定向测试 23/23，来源 CLI 回归 2/2，typecheck 通过。两份新阅读包逐项对比 files/definitions/facts/evidence/Snapshot/Overlay 与原分析一致，阅读模型初始化通过。Standards / Spec 两轴独立审查均无剩余发现。本轮未改 UI，未重复桌面交互旅程，也不声明真实应用运行验收。
