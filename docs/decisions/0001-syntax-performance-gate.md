# Syntax Extraction V0.1 性能 Gate

状态：V0.1 Accepted；V0.2 Follow-up Reopened

日期：2026-08-24

对应票：#10

## 决定

当前不进入 S4 性能优化，不预建 worker pool、edit-level old-tree 缓存、Rust Kernel 或双 runtime。

冻结 corpus 上的正确性结果为 `ready`，全量构建、单文件变化和隔离进程峰值内存均未越过首版预算。后处理与规范化是当前最大耗时阶段，但它没有形成产品预算瓶颈，因此不能仅凭占比启动优化。

## 可复核输入

- 实现基线：`07267e5`。
- Corpus：当前公开仓库的 `src/**/*.ts` 与 `benchmark/corpus/python/**/*.py`。
- Corpus Manifest Digest：`0a250869650f92d854e840164b23a9b6ac02ac9e82e2f69ee2a8bb89e10dc6ff`。
- 命令：`npm run benchmark:syntax`。
- 原始结果：[syntax-performance-baseline.json](../receipts/syntax-performance-baseline.json)。

每个测量样本在独立 Node.js worker 进程中运行，避免把同一进程多轮 native 分配的高水位误算成单次索引峰值。该模型覆盖一次全量构建和一次基于现有 Ready State 的单文件增量构建。

## 预算与结果

| Gate | 预算 | 实测 p95 / peak | 结果 |
| --- | ---: | ---: | --- |
| 全量 Pipeline | ≤ 150 ms | 78.473 ms | 通过 |
| 单文件增量 | ≤ 75 ms | 46.928 ms | 通过 |
| 隔离 worker 最大 RSS | ≤ 192 MiB | 141.6 MiB | 通过 |
| Canonical Coverage | `ready` | `ready` | 通过 |

阶段 p95：parse 5.127 ms、Query 4.132 ms、后处理与规范化估算 41.444 ms、Resolver 17.022 ms、Canonicalizer 13.671 ms。

正确性同时保存：167 个 Definition、319 个权威 Relation、533 个 unresolved Candidate、877 份 Evidence；规范图 hash 为 `97911e10a17341fb77128f6fc4cc3138094afedb6ebb51cb3ee11301f7a17ccf`。

## 边界与重新开启条件

当前 corpus 只有 19 个文件、89,417 bytes，结果只能作为 V0.1 本地链路基线，不能外推为大型仓库容量承诺。

出现以下任一条件时，重新进入 S4 Gate 并单独拆票：

- 冻结的大型公开 corpus 超过任一预算；
- 产品引入 daemon/watcher 后，长时间增量 soak 显示 RSS 持续增长；
- profiler 证明后处理、Resolver 或 Canonicalizer 的具体规则成为主要预算瓶颈；
- 任一优化都必须继续通过增量/全量规范图 parity，不得改变事实、排序、Coverage 或 Diagnostic。

## 2026-09-01 V0.2 产品化复测

实现基线 `bafb996` 上重新执行同一命令。当前源码 corpus 已增长到 32 个文件、188,938 bytes，因此本次结果不能覆盖或伪装成原 19 文件 V0.1 冻结基线；单独保存为 [syntax-performance-productization-followup.json](../receipts/syntax-performance-productization-followup.json)。

| Gate | 原预算 | V0.2 实测 p95 / peak | 结果 |
| --- | ---: | ---: | --- |
| 全量 Pipeline | ≤ 150 ms | 215.387 ms | 未通过 |
| 单文件增量 | ≤ 75 ms | 103.436 ms | 未通过 |
| 隔离 worker 最大 RSS | ≤ 192 MiB | 197,504 KiB | 未通过 |
| Canonical Coverage | `ready` | `ready` | 通过 |

决定为 `reopen_s4_measurement`：当前版本不得继续引用 V0.1 数据声称产品化基线仍在预算内。下一步应先冻结具有明确 revision 的代表性公开 corpus，并分别定位后处理/规范化和增量阶段的全仓 Resolver/Canonicalizer 成本；只有固定 corpus 或产品 SLA 再次证明具体瓶颈后，才拆 worker、缓存或 native runtime 优化票。
