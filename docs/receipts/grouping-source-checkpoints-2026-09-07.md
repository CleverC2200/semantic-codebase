# 自动分组独立核对点（生成前）

2026-09-07；仅阅读本地冻结 references/codegraph 与 references/poetry 源码。未执行样本，未从生成结果反推期望。分析范围为各自 src 下全部 TypeScript / Python 源文件；文件清单只限定分析范围，不定义业务映射。

- CodeGraph `src/extraction/kernel/index.ts:258` materializeKernelResult 调用 `decodeExtractBuffers`；同文件 tryKernelExtract 也调用此共享解码函数。预期 decode.ts 保持单独文件归属，并有跨文件使用证据。
- CodeGraph `src/extraction/kernel/loader.ts:141` getKernel 校验原生模块，kernelSupports 查询该缓存。只可建议内核加载职责，不代表执行过原生模块。
- CodeGraph `src/extraction/kernel/layout.ts:1` 是 ABI 缓冲区常量布局；目录名 kernel 和常量多不能直接证明一项业务流程。
- Poetry `src/poetry/repositories/repository_pool.py:130` add_repository / remove_repository 管理有优先级的仓库，package / find_packages 检索包；文件归属应完整保留，不能仅把所有 pool 命名视为缓存支撑。
- Poetry `src/poetry/utils/cache.py:75` FileCache 提供文件缓存，ArtifactCache 为制品缓存；仓库池 artifact_cache 属性返回该共享实现。跨目录归属不能把缓存文件吞并到仓库池。
- 同名 get、has、add 等通用动词不构成业务职责证据。外部依赖、动态调用或本分析未解析关联应保留 unknown。

后续人工核对只对这些已读源码点给出结论；模块全覆盖不等于业务理解正确率。

全量 TypeScript 首次索引未通过：上述三个现有 grammar 不支持文件 src/db/queries.ts, src/resolution/callback-synthesizer.ts, src/telemetry/index.ts 有 syntax_error，未发布 Ready。后续范围显式缩为其余 176 文件，排除项不算已覆盖；不是通用全仓库索引验收。

176 文件重试仍被既有 Canonical Graph Ready 门禁拒绝（snapshot_not_ready）。最终已发布分析范围为 src/extraction/kernel/ 下 4 个 TS 文件、28 个定义；全仓库能力未验收，layout.ts 仅保留结构常量，跨范围外部引用仍为未知。
