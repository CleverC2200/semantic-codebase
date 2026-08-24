# 确定 V0.1 验证矩阵与发布门槛

Type: grilling
Status: resolved
Blocked by: 04, 07, 08, 09, 10, 15
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

V0.1 应如何组合 Fixture 契约测试、Adapter 一致性测试、快照与增量测试、查询正确性、64-run Agent Smoke、性能和隐私检查；哪些失败必须阻止内部发布，哪些能力允许以已知限制交付，以及如何汇总本地验证与 Benchmark Receipt？完整 Evidence Benchmark 不属于内部 V0.1 硬门槛。

## Comments

- 已认领；本票只定义验证顺序、硬门槛、可交付限制和 Acceptance Receipt，不实现测试或运行 Agent Smoke。
- 用户明确角色分工：用户只决定产品方向，技术细节由 Agent 参考现有开源项目自行判断；优先快速形成可体验原型，不以完整发布治理阻塞首次反馈。

## Answer

验证分成“Prototype Gate”和“V0.1 Release Gate”两个里程碑。首次原型只证明主链路可用；发布门槛在原型获得方向性反馈后再执行，不把完整验收前置成开发阻塞。

### Prototype Gate

原型必须完成以下最小验证：

1. TypeScript 与 Python 各一个受控 Fixture 能完成 `index -> find definition -> traverse CALLS/REFERENCES -> get evidence`。
2. 同一 Fixture 连续三次全量索引得到相同规范化 hash。
3. 对一组增删改文件执行一次增量同步，结果与重新全量索引语义等价。
4. CLI 与 MCP 对同一规范请求返回等价的 `QueryResult`，包含 Snapshot、Completeness、Coverage 和 Evidence。
5. 在一个冻结的真实开源项目上完成 Definition 定位、callers、路径和静态证据不足拒答四条人工演示路线。
6. 索引和查询保持本地、只读源码、默认断网；不得读取仓库外源码或写回目标仓库。

Prototype Gate 的阻塞项只有：主链路崩溃、产生已知错误的权威 Relation/Evidence、结果不确定、增量与全量不一致、CLI/MCP 语义漂移或越权访问。性能、覆盖率和动态语言边界先记录观察值，不因未达发布级阈值阻塞原型展示。

### V0.1 Release Gate

原型方向被接受后，按成本从低到高执行：

```text
G1 Fixture 与 Canonical IR 契约
G2 Snapshot、增量、确定性与 Graph Store
G3 CLI/MCP、性能、隐私与打包
G4 64-run Agent Smoke
```

任一 Gate 失败即停止后续 Gate。只有 `core` Adapter Profile 参与 V0.1 认证；`core+scip-ts` 是显式实验 Profile，单独报告且不得静默成为默认配置。

G1 必须覆盖五种 Definition、七种 Relation、Relation Candidate、Evidence 范围和 TypeScript/Python 公共 JSON Contract。支持范围内的 Fixture 期望事实必须 100% 命中，且不得产生额外的错误权威事实。

G2 必须证明连续 10 次规范化索引 hash 一致、增量与全量语义等价、Snapshot 发布原子性、失败构建不替换 current ready、Freshness/retention/pin 行为正确，以及遍历排序、循环、预算、截断和路径结果确定。

G3 必须证明六个 CLI/MCP 操作共用 Schema、默认值、错误码和序列化；CLI stdout/stderr、MCP structuredContent、Evidence 字节预算与路径安全符合契约。冻结真实 Corpus 上默认查询必须在 2 秒默认 timeout 内完成；完整索引时间、增量时间、峰值内存和 Store 大小作为观察指标。网络、仓库写入、路径越界、Gold/日志可见或非白名单工具均为硬失败。

G4 使用已冻结的 `gpt-5.6-terra/high` 64-run Agent Smoke 契约。它只确认 Agent 集成无明显正确性回退且 Token/源码读取方向改善，不承担对外 60%/50% 量化声明。

### 可交付限制

允许带着发布的只能是明确能力边界，例如动态调用、反射、插件发现、已报告的 Relation Candidate、显式排除目录和调用方允许的 stale Snapshot。每项必须具有影响范围、Evidence、用户可见 Diagnostic 和解除条件。

以下情况不得豁免：已知错误 Relation、错误 Evidence、结果不确定、增量不等价、Snapshot 混读、静默 Profile 降级、CLI/MCP 漂移、数据损坏或隐私/隔离失败。

### Acceptance Receipt

原型只保存一份轻量收据：源码 revision、Profile、Fixture/真实项目、核心命令、测试结果、规范化 hash、已知限制和演示路线。

V0.1 发布收据再追加各 Gate 的环境与产物 hash、Coverage、性能观察、64-run Benchmark Receipt 汇总和未关闭 Known Limitation。收据不得包含源码全文、认证信息、账户标识、Token、Cookie 或其他秘密。
