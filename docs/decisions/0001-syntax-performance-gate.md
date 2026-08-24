# Syntax Extraction V0.1 性能 Gate

状态：Accepted

日期：2026-08-24

对应票：#10

## 决定

当前不进入 S4 性能优化，不预建 worker pool、edit-level old-tree 缓存、Rust Kernel 或双 runtime。

冻结 corpus 上的正确性结果为 `ready`，全量构建、单文件变化和隔离进程峰值内存均未越过首版预算。后处理与规范化是当前最大耗时阶段，但它没有形成产品预算瓶颈，因此不能仅凭占比启动优化。

## 可复核输入

- 实现基线：`26f2062`。
- Corpus：当前公开仓库的 `src/**/*.ts` 与 `benchmark/corpus/python/**/*.py`。
- Corpus Manifest Digest：`f3a8a98f49b4ddf3ff054feb81b5a3ba98add3c1ee5ab40258aceee35b61796b`。
- 命令：`npm run benchmark:syntax`。
- 原始结果：[syntax-performance-baseline.json](../receipts/syntax-performance-baseline.json)。

每个测量样本在独立 Node.js worker 进程中运行，避免把同一进程多轮 native 分配的高水位误算成单次索引峰值。该模型覆盖一次全量构建和一次基于现有 Ready State 的单文件增量构建。

## 预算与结果

| Gate | 预算 | 实测 p95 / peak | 结果 |
| --- | ---: | ---: | --- |
| 全量 Pipeline | ≤ 150 ms | 89.098 ms | 通过 |
| 单文件增量 | ≤ 75 ms | 49.934 ms | 通过 |
| 隔离 worker 最大 RSS | ≤ 192 MiB | 141.4 MiB | 通过 |
| Canonical Coverage | `ready` | `ready` | 通过 |

阶段 p95：parse 5.524 ms、Query 4.455 ms、后处理与规范化估算 43.108 ms、Resolver 17.522 ms、Canonicalizer 15.932 ms。

正确性同时保存：164 个 Definition、314 个权威 Relation、519 个 unresolved Candidate、858 份 Evidence；规范图 hash 为 `043086cca87944de632dd03685ef6cfd1ed0c0f670b3a514f45c4e3ac59b524e`。

## 边界与重新开启条件

当前 corpus 只有 19 个文件、87,095 bytes，结果只能作为 V0.1 本地链路基线，不能外推为大型仓库容量承诺。

出现以下任一条件时，重新进入 S4 Gate 并单独拆票：

- 冻结的大型公开 corpus 超过任一预算；
- 产品引入 daemon/watcher 后，长时间增量 soak 显示 RSS 持续增长；
- profiler 证明后处理、Resolver 或 Canonicalizer 的具体规则成为主要预算瓶颈；
- 任一优化都必须继续通过增量/全量规范图 parity，不得改变事实、排序、Coverage 或 Diagnostic。
