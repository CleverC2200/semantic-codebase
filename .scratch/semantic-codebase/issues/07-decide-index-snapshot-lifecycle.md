# 确定索引、版本快照与增量更新生命周期

Type: grilling
Status: resolved
Blocked by: 05, 06
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

仓库首次索引、文件变更、提交切换、分支切换、删除与重命名时如何生成和切换 Graph Snapshot；增量更新的原子性、一致性、失败恢复、陈旧状态和重复运行幂等性如何定义；V0.1 需要保存多少历史，以及何时允许完整重建？

## Comments

## Answer

V0.1 只提供显式 `index、sync、status`，不实现常驻 watcher、后台 daemon 或自动同步。索引生命周期的目标是保证图的完整性与可追溯性；自动触发等 P3 的真实使用频率和收益明确后再决定。

Snapshot ID 由完整分析输入确定：

```text
snapshot_id = hash(
  repository_id,
  source_manifest_digest,
  canonical_ir_version,
  adapter_profile_digest,
  index_config_digest
)
```

Clean Git 工作树记录 commit OID；Dirty 工作树记录 base commit 与完整源码 manifest。Branch 名只作展示元数据，不进入身份。

Snapshot 状态机固定为：

```text
building -> ready | failed | superseded
```

只有 `ready` Snapshot 可以查询。Repository 通过单事务切换 `current_ready_snapshot` 指针，构建过程永不原地修改旧 Snapshot。发布前依次完成：捕获 Manifest、在新 Snapshot 抽取、解析跨文件关系、验证端点/Evidence/唯一性/覆盖状态、再次核对当前 Manifest、原子切换指针。构建期间源码若再次变化，产物标记 `superseded`，旧 ready Snapshot 继续服务。

增量更新只是实现优化：未变化文件可物理复用，变化文件完整重抽取，删除不进入新 Snapshot，重命名按删除加新增处理，并重新解析受影响的跨文件 Relation。对相同输入，增量与完整重建必须产生相同规范化图。

每个 Repository 同时只允许一个 writer。目标输入相同时复用现有 building/ready Snapshot；输入更新时旧构建可安全取消或完成为 superseded。同一输入重复十次，规范化图 hash 必须完全一致；Adapter Run 可以重复记录，但不得重复 Definition 或 Relation。

源码已变化但 sync 尚未成功时，可以返回最近 ready Snapshot，但响应必须带：

```text
freshness = stale
snapshot_id
indexed_manifest
observed_manifest
stale_reason
```

调用者指定 `require_fresh=true` 时，系统必须明确失败，不能静默使用旧图。

默认保留当前 ready、上一个 ready、明确 pinned 的 Benchmark Snapshot，以及最近五次 failed/superseded 的诊断元数据；失败产物不保留完整图，其他未 pinned 历史允许回收。

没有兼容 ready Snapshot、Canonical IR/Adapter profile/index config 版本改变、Store 完整性失败或用户显式 `index --rebuild` 时必须完整重建。其他情况下系统可自行选择增量或全量策略，但该选择不属于公共 Interface。
