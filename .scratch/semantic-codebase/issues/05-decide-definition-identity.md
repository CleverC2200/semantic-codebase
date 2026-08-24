# 确定 Definition 身份与版本连续性

Type: grilling
Status: resolved
Blocked by: 02
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

Definition 的稳定身份如何与名称、文件位置和 content hash 解耦；重命名、移动、实现修改、复制、拆分、合并和跨分支历史分别如何处理；何时视为同一个 Definition 的新版本，何时创建新身份，以及系统无法确定连续性时如何表达？

## Comments

用户指出项目重点是代码语义，而不是构建完整的代码版本身份系统。V0.1 因此采用 Snapshot 内身份，不承诺跨版本逻辑连续性。

## Answer

V0.1 的 Definition 是某个不可变 Snapshot 中可寻址的代码声明，不是跨提交、跨分支长期稳定的逻辑实体。每个 Definition 使用可重复计算的：

```text
definition_key
= hash(snapshot_id, language, kind, canonical_path, qualified_name, source_range)
```

并保存独立的 `content_hash` 与源码 Evidence。相同 Snapshot 和相同索引配置重复构建，必须产生相同 Definition Key；Key 不使用随机 UUID。

跨 Snapshot 时：

- 实现修改、重命名、移动都可以产生新的 Definition Key。
- PR/Diff 可以临时报告 `renamed`、`moved`、`modified` 等比较结果，但这些只是绑定两个 Snapshot 的派生结果，不写成权威永久身份。
- V0.1 不处理复制、拆分、合并、删除后恢复、跨分支或跨仓库身份连续性。
- 任何 Capability、Requirement 或其他语义实体都不得把 Definition Key 当作自身身份；它们通过带 Snapshot 和 Evidence 的关系引用实现。

到 P5 Evidence Graph/P6 Capability Graph 形成后，再根据真实的 `IMPLEMENTED_BY`、变更追踪和人工复核需求决定是否需要 Definition Lineage。该能力在此之前不进入 Canonical IR。
