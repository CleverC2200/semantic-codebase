# Semantic Understanding V0 Preview

状态：Accepted

目标：停止继续展开架构选项，采用成熟、本地、可替换的默认技术，优先交付一条用户可以实际运行和观察结果的纵向链路。

## 1. 第一版效果

第一版以 `references/zod` 为真实 TypeScript 语料，输出：

- Definition 的编译器类型摘要；
- CallSite 与 exact/possible CallTarget；
- 基础控制步骤和 Effect；
- Entrypoint 与 Application Flow；
- 每项结论的源码 Evidence、Coverage 和 unknown；
- JSON 生成物、本地 HTML 验收页，随后写入 SQLite 并通过 CLI 查询。

Python、Runtime Observation、Capability Candidate 和 Codex Evidence Answer 复用同一数据模型继续补齐，不阻塞第一版 Zod 预览。

## 2. 推荐默认值

| 决策领域 | V0 默认值 |
|---|---|
| TypeScript | 直接使用 TypeScript Compiler API；不引入 ts-morph 或 SCIP |
| Python | 使用本地 Pyright；环境不完整时显式返回 Coverage 缺口 |
| Call | 一等 CallSite；目标分为 exact、possible、observed，动态分派保留 unknown |
| Control Flow | 函数内 Basic Block 与 branch/loop/return/throw/await 边；不先做完整编译器 IR |
| Data Flow | 函数内 def-use，加有预算的一跳参数到返回值传播 |
| Effect | return、throw、state、file、database、network、event 七类；未知库调用保持 unknown |
| Framework | 版本化规则；首批 TypeScript Express、Python FastAPI；启发式不升级为 exact |
| Entrypoint | exported API、CLI、HTTP route、event handler、scheduled job |
| Runtime | 只导入冻结 OpenTelemetry JSON；V0 不主动插桩或启动目标程序 |
| Application Flow | 从 Entrypoint 按 call、control、data 和 effect 合成主线及关键分支 |
| Capability | 只生成 Candidate；人工接受、拒绝或合并后才形成稳定 Capability |
| Store | 复用 SQLite；Overlay 绑定 Snapshot，完整重建和原子发布优先 |
| Context | 少量 typed Query Intent、本地 Planner、Evidence Validator；Codex 仅做可选表达与消歧 |
| Benchmark | Zod + 小型 Python fixture；正确性和 Evidence 优先，性能先记录基线 |

## 3. 实施 Issue

- [Epic：Semantic Understanding V0 可运行预览](https://github.com/CleverC2200/semantic-codebase/issues/41)
- [V0.1 最小 Enrichment Contract](https://github.com/CleverC2200/semantic-codebase/issues/42)
- [V0.2 TypeScript Compiler 与 Zod 预览](https://github.com/CleverC2200/semantic-codebase/issues/43)
- [V0.3 Behavior、Effect、Entrypoint 与 Flow](https://github.com/CleverC2200/semantic-codebase/issues/44)
- [V0.4 SQLite Overlay 与 CLI](https://github.com/CleverC2200/semantic-codebase/issues/45)
- [V0.5 Pyright Python 纵切片](https://github.com/CleverC2200/semantic-codebase/issues/46)
- [V0.6 Runtime Observation 与 Capability Candidate](https://github.com/CleverC2200/semantic-codebase/issues/47)
- [V0.7 Context Package 与 Codex Evidence Answer](https://github.com/CleverC2200/semantic-codebase/issues/48)
- [V0.8 Zod/Python Preview Gate](https://github.com/CleverC2200/semantic-codebase/issues/49)

## 4. 执行顺序

最快可见链路：

```text
V0.1 → V0.2 → V0.3 → 生成 Zod JSON/HTML
                    ↓
                   V0.4 → SQLite/CLI
```

完整预览继续：

```text
V0.4 → V0.5
  ├──→ V0.6
  └──→ V0.7（等待 V0.6 的 Capability 输入）
             ↓
            V0.8
```

实现期间不自动提交、推送或创建 PR。每个切片通过自己的定向测试后继续下一票；昂贵测试前检查磁盘余量。
