# TypeScript grammar 与完整范围验收 · 2026-09-08

此前排除的三个文件现在全部进入分析范围，179 文件成功生成 Ready Snapshot。结构索引的成功不等于 Semantic Overlay 或业务解释 complete；两者仍明确为 partial。

## 实际改动

- 继续使用锁文件指定的 tree-sitter-typescript 上游版本和原生 ABI 14，没有升级依赖或改写输入源码。在既有准备脚本增加两个受原始文件 SHA 校验约束的补丁。
- `_reserved_identifier` 增加上下文关键词 unique，使 `i<unique.length` 保持二元比较；仍支持类型位置的 unique symbol。
- 单/双引号的 string fragment 显式接受 NUL 字节，区别于 EOF。裸 NUL 与未闭合字符串仍报语法错误；后续定义与 UTF-8 字节范围保留。
- grammar profile 从 0.23.2-scb.1 升为 0.23.2-scb.2，parser.c 摘要从 1c28b7548c12fd4edaf30668c31bf35453ebf032e57b066020e73007d59050db 变为 aab8611ac5315d03eb6637d7c135a8900b905c9864322d5ab2c1343d0df13621。启动探针增加新语法，防止只更新生成源码却加载旧原生绑定。

## 验证

两个新增最小复现在修复前均为 partial、断言失败；修复后通过。语法抽取、关系候选和增量索引定向测试 25/25 通过，typecheck 通过。prepare:grammar 已完成首次应用及重复执行，TypeScript / TSX 都验证 in/out、unique 比较、unique symbol、引号内 NUL 与非法输入拒绝；重复生成保持相同 parser 摘要。

原完整范围诊断不再有 error。新 source receipt 标 directory_snapshot，source_head / source_status 为 null；没有重新引入父仓库身份。与上一轮的 176 个公共文件逐项比对 source_digest，全部相同；剩余 3 个文件原字节直接分析，未做转义替换或错误过滤。

- 范围：179 文件，2516 定义，54977 Fact，124444 Evidence。
- Snapshot：`546de0ef32493c3b8e9838a0a6163ad398dc98b7452d7c996c3707078b026bac`。
- Overlay：`2420371e34027d16ce18a806eb44f552db3769158083305bafea89c48b62fa26`。
- 分组：2516 / 2516 定义有结构归属，124 条未验证职责建议，13535 条未知关联；没有预算截断、没有人工专用映射。
- 单次本机分析 9291 ms，分组 1569 ms；不是跨设备或 p95 性能承诺。

分析产物 .workspace/acceptance/grouping-codegraph-179-20260908，阅读产物 .workspace/acceptance/grouping-codegraph-full-20260908。完整范围见 [179 文件清单](grouping-inputs/codegraph-179.json)。按 README 先运行 npm run prepare:grammar 与 npm run build，再以该清单执行 run-source-reader / run-reader-grouping，输出到新目录。

旧 Snapshot / Overlay 和 4/176 文件历史收据不回写。新 grammar 身份要求重新分析，旧缓存及新原生绑定不能混用。本机 macOS、Node 24.14.1 原生准备通过；未验证其他操作系统安装，未执行样本应用、调用模型或外传源码。

最终验证：隔离的实际待提交树构建成功，完整测试 257/257 通过；Standards / Spec 两轴复核均无剩余问题。待提交版本渲染的全范围阅读产物为 .workspace/acceptance/grouping-codegraph-full-delivery-20260908，HTTP 本地访问返回 200；阅读模型初始化正常，所有冻结 files/definitions/facts/evidence 与 Snapshot/Overlay 逐项保持一致。本轮没有 UI 代码改动，未重复上一轮完整桌面点击旅程。
