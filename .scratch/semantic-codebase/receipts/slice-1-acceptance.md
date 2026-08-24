# V0.1 Slice 1 Acceptance Receipt

日期：2026-08-17（Asia/Shanghai）

## 范围

历史实现当前归档目录：`references/semantic-codebase/`

本收据只覆盖 Slice 1：

- TypeScript/Python Tree-sitter SyntaxAdapter。
- module、class、interface、function、method Definition。
- Snapshot 内确定性 Definition Key、源码 Evidence 与 content hash。
- SQLite GraphStore 与原子 Ready Snapshot 写入。
- `scb index`、`scb definitions find`、`scb definition get`。

## 环境

```text
Node.js: v24.14.1
npm: 11.11.0
tree-sitter: 0.21.1
tree-sitter-typescript: 0.23.2
tree-sitter-python: 0.21.0
TypeScript: 7.0.2
```

验收执行当时聚合工作区尚不是 Git repository，因此本收据没有伪造 revision；源码位置和依赖锁文件作为当时实现定位依据。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 4/4 通过 |
| `npm run build` | 通过 |
| TS/Python Definition + Evidence | 通过 |
| 五种 Definition kind | 通过 |
| 三个 CLI 命令输出可解析 JSON | 通过 |
| 连续三次全量索引 | 同一 graph hash |
| 索引过程修改 fixture 源码 | 未修改 |

三次全量索引的规范图 hash：

```text
270ffea33df40dcdc1bad9105fe4d0e9af579549bd963e6c76d9bd902e9bf079
```

## 已知限制

- 尚未实现 Relation、Relation Candidate、traverse、paths、evidence get、sync 或 MCP；它们属于后续切片。
- 当前只识别 `.ts`、`.tsx` 和 `.py`。
- Snapshot revision 暂为 `null`；Git clean/dirty revision 捕获属于 Snapshot 生命周期切片。
- Node.js 24 的内置 `node:sqlite` 当前会向 stderr 发出 experimental warning，不污染 CLI stdout JSON。发布硬化阶段需要决定继续使用内置实现还是替换驱动。
- 语法错误的详细 Diagnostic/Coverage 表达尚未完成；不能据此宣称错误文件被完整分析。

## 结论

Slice 1 已达到“第一个可查询 Definition”的完成条件，可以进入 Slice 2：`CONTAINS / IMPORTS / EXPORTS`、Relation Candidate、`traverse` 与 `evidence get`。
