# Zod v3 Prototype Gate 验收收据

本收据记录 2026-08-26 在固定 Zod revision `1fb56a5c18c27102dbc92260a4007c7732a0ccca` 上执行的真实项目门禁。Prototype Gate 覆盖 `packages/zod/src/v3` 下 83 个受支持 TypeScript 文件（489,551 bytes），包含产品源码、测试和 benchmark；原有 13 文件 smoke corpus 仍单独保留，用于更小且稳定的生产源码回归。

## 结果

- Ready：通过。
- Freshness：`fresh`。
- Definitions：546。
- Relations：892。
- Unresolved Candidates：7,939，保持显式可见，未冒充权威 Relation。
- 禁止自环：0。
- 非 SourceFile/module 的 `EXPORTS` source：0。
- SQLite round-trip graph hash：一致。
- no-op incremental sync：83 个文件全部复用，Snapshot ID 不变。
- 同一输入连续 10 次 graph hash：一致。
- CLI/MCP canonical result：一致。
- 默认 status/Definition/traverse/paths/Evidence 查询：均低于 2 秒。
- 固定 Relation Gold scope：源函数为 `util.getValidEnumValues`、关系类型为 `CALLS`；该范围内唯一关系是 `util.getValidEnumValues --CALLS--> util.objectValues`，无缺失或额外 Relation。
- Receipt 同时记录 Manifest digest、Canonical/Adapter Profile、可复现命令、SQLite Store 大小和 Gate 进程峰值内存。

## 用户链路证据

门禁通过同一 CLI/Query/MCP 实现执行：

```text
index → status → definitions find
→ graph traverse（callers/callees）
→ graph paths → evidence get
→ MCP 同请求 parity
```

真实关系样例为：

```text
util.getValidEnumValues
  --CALLS-->
util.objectValues
```

Evidence 位于 `helpers/util.ts`，源码 digest 校验通过且片段未截断。

## 静态边界

对不存在于 Ready Snapshot 的 `definitelyRuntimeOnlyDynamicSymbol`，结果明确保持：

```text
decision = insufficient_static_evidence
```

空结果只表示当前 Ready Snapshot 内未找到，不能据此断言运行时绝对不存在。动态调用、反射和不支持语法继续保留为已知边界；Unresolved Candidate 由 Coverage 显式回显。

## 本地验收工件

执行 `npm run prototype:zod` 会重新生成：

- `.workspace/acceptance/zod-prototype/acceptance.html`
- `.workspace/acceptance/zod-prototype/receipt.json`
- `.workspace/acceptance/zod-prototype/summary.md`
- `.workspace/acceptance/zod-prototype/prototype.sqlite`

这些工件只保留在本地，不进入公开 Git 历史。

`receipt.json` 是机器可读的完整收据；本文只保留稳定结论，运行时间、Store bytes 和峰值内存以最近一次本地生成的 JSON 为准。
