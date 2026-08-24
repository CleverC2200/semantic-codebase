# 确定 Syntax Adapter 与 Semantic Enricher Seam

Type: grilling
Status: resolved
Blocked by: 02, 06, 07
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

Source Index Module 应如何分开逐文件语法抽取与仓库级语义富集，使不同分析能力在进入 Canonical IR 前保持可替换、可追溯和可复现；V0.1 启用哪些分析档位，如何处理冲突、失败和能力差异，而不泄漏第三方内部 schema？

## Comments

- 原问题把 CodeGraph 与 SCIP 都视为运行时 Source Adapter。前置研究确认 CodeGraph 应只作为实现参考和 P0 Benchmark 对照，因此本票改名并重新划定真正需要的两个 Seam。
- 用户接受本轮全部推荐答案；本票不再保留待确认分支。

## Answer

V0.1 在 Source Index Module 内设置两个不同阶段的 Seam，由 Canonicalizer 统一收口，不定义一个无所不包的 `SourceAdapter -> FactBatch`：

1. `SyntaxAdapter.extract(SourceFileInput) -> SyntaxSlice` 是逐文件、确定性的语法抽取 Interface。输入包含 Snapshot、文件路径、内容摘要、语言、源码字节和版本化配置；输出包含 `DefinitionDraft`、可由单文件确定的 `ExactRelationDraft`、`RelationCandidate`、`FactDraft`、Evidence、Coverage 与 Diagnostics。它不得生成最终 Definition Key、写入 Graph Store，或声称完成跨文件解析。
2. `SemanticEnricher.enrich(FrozenRepositoryInput, BaseExtractionView) -> SemanticSlice` 是仓库级、可选的语义富集 Interface。它在冻结的仓库清单和基础抽取视图上解析候选、补充 Evidence 和语义事实；Canonicalizer 负责验证、合并、生成最终 Definition Key，并产出 Canonical IR。

### V0.1 分析档位

- `core`：TypeScript Tree-sitter + Python Tree-sitter + 自有确定性 Resolver。它是双语言正式 Release Benchmark 的唯一必测档位。
- `core+scip-ts`：在 `core` 上增加 `scip-typescript` Semantic Enricher。它是实验档位，单独报告覆盖率、正确率、成本与失败，不与 `core` 混报。
- Python 的 SCIP Enricher 不进入 V0.1；待独立工具链的复现性和增益通过后再考虑。
- CodeGraph 不作为生产 Adapter，不进入 Snapshot 的能力声明；它只用于实现参考和 P0 对照。

### 富集与冲突规则

- SCIP 只能匹配既有 Definition、解析 Relation Candidate、补充 Evidence 或新增其能力清单明确声明的语义事实。
- SCIP 不得覆盖语法源码范围、创建冻结 Manifest 之外的 Definition，或删除 Syntax Adapter 已确认的事实。
- 两个来源对同一权威事实发生不可调和冲突时，不按置信度、执行顺序或“最后写入者”自动选择。Canonicalizer 保留双方 Evidence，产生 Diagnostic，并把冲突 Relation 排除在权威 Structural Graph 之外。

### 失败、降级与 Coverage

- 请求的 Adapter Profile 是 Snapshot 身份与能力契约的一部分，不允许静默降级。请求 `core+scip-ts` 而 SCIP 未运行成功时，Snapshot 必须进入 `failed`，调用方应明确改用 `core` 重建。
- 任一语言的 Syntax Adapter 整体不可用时构建失败；单文件语法错误可发布 Ready Snapshot，但必须在 Coverage 和 Diagnostics 中标记部分覆盖与未解析候选。
- 查询方只读取 Canonical IR 中归一化的 Coverage 和 Diagnostics，不接触 Tree-sitter、SCIP 或其他第三方 schema。

### 可复现与安全约束

- Adapter 只读冻结源码 Manifest；禁止联网、安装依赖和修改仓库；临时目录必须受控，并执行时间、内存、输出大小和进程数上限。
- 每次运行记录 Adapter id/version、Profile、配置摘要、输入摘要和环境要求；输出必须稳定排序，并通过重复运行字节等价或语义等价测试。
- 每个 Adapter 提供版本化 Capability Manifest，至少声明 id、version、phase、languages、Definition kinds、Relation kinds、Fact namespaces 与环境要求。运行结果另行报告实际 Coverage 和 Diagnostics，声明能力不等于实际覆盖。

该设计保留两个真实变化点：逐文件语法解析器和仓库级语义富集器；Canonicalizer 与 Graph Store 不感知第三方内部模型。V0.1 的正式质量基线不会依赖 SCIP，但 TypeScript 可以用独立实验档位量化 compiler-aware 语义的真实增益。
