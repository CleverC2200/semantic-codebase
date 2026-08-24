# 确定 V0.1 Agent Smoke 与可选 Benchmark 执行配置

Type: grilling
Status: resolved
Blocked by: 13
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

根据冻结 Corpus，强制的 64-run Agent Smoke 与可选的完整 Evidence Benchmark 应如何使用现有 Codex：选择哪种运行入口、模型与资源上限，如何只改变代码探索工具、隔离 Gold、记录收据，并区分应计分失败、基础设施无效和 Epoch 变化？

## Comments

- 已认领；只读核对现有 Codex CLI 与官方能力，不安装模型、不运行正式 Benchmark、不向外部服务发送项目源码。
- 官方文档确认 `codex exec` 是稳定的脚本/CI 非交互入口，支持只读 sandbox、JSONL 全事件流、最终输出 Schema、临时会话及忽略用户配置；参考 [Non-interactive mode](https://developers.openai.com/codex/noninteractive) 与 [CLI reference](https://developers.openai.com/codex/cli/reference)。
- 本机只读审计确认 `/opt/homebrew/bin/codex` 为 `codex-cli 0.147.0`，具备本票所需 flags；未读取认证文件或用户配置，未发起模型调用。CLI 不能固定服务端模型 revision、随机种子、账户配额或供应侧路由。
- HITL 第一轮：用户接受推荐，正式 Benchmark 仅使用 `codex exec`；每题创建全新 ephemeral session，不使用桌面任务、直接 API 或 session resume。
- HITL 第二轮：三组关闭通用 shell/Web/Skills/Memory/Subagent 等能力，只分别开放 rg/read Baseline MCP、CodeGraph MCP 或六个 Semantic Codebase MCP Tool。模型最初推荐 `gpt-5.6-sol`，用户随后明确改为每个 Epoch 固定 `gpt-5.6-terra`、`high`、`codex-cli 0.147.0` 与 default service tier；本机 bundled catalog 已确认该 slug 支持 `high`。
- HITL 第三轮：用户接受单 run 使用 131,072 context、10 分钟 wall timeout 和 40 次 Tool 调用上限；每次全新进程与 ephemeral session，三组按题配对并按冻结随机顺序执行；执行期只有 Codex CLI 可连接 OpenAI，探索工具断网，Gold 与结果目录对 Agent 不可读。
- 范围修订：用户确认内部 V0.1 只强制执行“本地确定性验证 + 16 题、Baseline/V0.1 两组、两次重复的 64-run Agent Smoke”；原 960-run 三组完整 Benchmark 降为对外量化或重大阶段决策时才运行的可选 Evidence Benchmark。
- HITL 最终轮：用户接受 16 题的语言/层级配额、轻量正确性与成本门槛、8 小时 Epoch、基础设施重试规则和逐 run Benchmark Receipt。

## Answer

V0.1 强制执行轻量 Agent Smoke，不再以完整 960-run Benchmark 阻塞内部交付。完整评测改称 Evidence Benchmark，仅在对外发布量化结论、P2→P3 重大投资决策或建立公开长期回归基线时另开票、另开 Epoch 执行。

### 固定 Codex Profile

强制 Smoke 使用本机现有的托管 Codex，不部署本地模型：

```text
entrypoint: codex exec
model_slug: gpt-5.6-terra
reasoning_effort: high
codex_cli: 0.147.0
service_tier: default
model_context_window: 131072
wall_timeout: 10 minutes
max_tool_calls: 40
concurrency: 4
session: fresh + ephemeral
sandbox: read-only
approval: never
```

参考命令形状：

```bash
codex -a never exec \
  --ignore-user-config \
  --ignore-rules \
  --ephemeral \
  --strict-config \
  -C "<frozen-repository>" \
  -m gpt-5.6-terra \
  -c 'model_reasoning_effort="high"' \
  -c 'model_context_window=131072' \
  -s read-only \
  --json \
  --output-schema "<answer-schema.json>" \
  -
```

`codex exec` 是正式非交互入口；`--json` 的 stdout JSONL 用于保存完整工具事件与 usage，最终答案另按 `--output-schema` 校验。官方依据：[Non-interactive mode](https://developers.openai.com/codex/noninteractive)、[CLI reference](https://developers.openai.com/codex/cli/reference)、[Configuration reference](https://developers.openai.com/codex/config-reference)。

每题必须启动新进程和全新 ephemeral session，禁止桌面任务、直接 API、resume、隐式模型选择或自动模型回退。`gpt-5.6-terra` 不可用时属于基础设施无效，不能临时替换模型继续同一 Epoch。

### 64-run Agent Smoke

Smoke 固定为：

```text
16 questions × 2 groups × 2 repeats = 64 runs
```

题目包含 8 道 Fixture 和 8 道冻结开源项目题；TypeScript/Python 各 8 道，L0 Definition 定位、L1 单关系、L2 跨文件路径、L3 静态边界拒答各 4 道。

只比较两组：

1. Baseline：唯一开放的探索能力是只读 MCP 包装的 `rg` 与按范围读取文件。
2. V0.1：唯一开放的探索能力是六个 Semantic Codebase MCP Tool。

两组关闭通用 shell、Web Search、Browser、Skills、Memory、Subagent、图片工具及其他 MCP；使用相同模型、题目、Prompt、Answer Schema、Scope、资源上限和冻结源码。Prompt 只要求使用可用代码探索工具，不暴露组名。JSONL 中出现非白名单 Tool 即该 Epoch 失格。

CodeGraph 不进入强制 Smoke，只保留为实现参考和可选 Evidence Benchmark 参照。

### 运行与隔离

- 准备阶段可受控联网，验证 commit、lock hash、连续两次清洁构建/测试并生成 CodeGraph/V0.1 只读索引；索引时间、体积和资源单独报告，不计入 Agent 回答时间。
- 评测阶段只有 Codex CLI 可访问 OpenAI 托管服务；Baseline/V0.1 MCP、目标源码及其子进程全部禁止外网。
- 每个 run 使用独立只读 checkout 视图和临时目录；不复用对话、工具结果或模型上下文。只读 Ready Snapshot 可以跨同组 run 共享。
- Gold、评分器、隐藏断言、其他组结果和原始日志位于 Agent 不可读目录；Agent 完成并退出后，外层 Harness 才读取 Gold 评分。
- 每题的 Baseline/V0.1 组成配对 block；两个 repeat 的组内顺序由预先冻结的随机 Manifest 决定。
- 一个 Smoke Epoch 从首个正式 run 到最后一个 run 不得超过 8 小时；超过即作废，不能拼接跨窗口结果。

### Smoke 通过标准

本地确定性验证仍是独立硬门槛。Agent Smoke 还必须满足：

- 64 个最终响应全部符合 Answer JSON Schema。
- V0.1 的 32 个回答中，正确数量不得比 Baseline 少超过 2 个。
- 不得出现同一道题 Baseline 两次全对而 V0.1 两次全错的完全回退。
- V0.1 的输入 Token 中位数和源码读取字节中位数都必须低于 Baseline。
- 不得发生 Gold 泄漏、非白名单 Tool、跨 Snapshot 或隔离失败。

Smoke 只证明没有明显 Agent 集成回退且成本方向正确；它不支持 -2 个百分点统计非劣、文件下降 60% 或 Token 下降 50% 等对外量化声明。

### 失败、重试与收据

回答错误、拒答错误、最终 JSON 不合法、Tool 参数错误、10 分钟超时、40 次调用耗尽或上下文耗尽都是有效的被评分失败，不得重跑。

认证中断、平台限流、Codex 服务错误、Runner 崩溃或 MCP 未启动属于基础设施无效，可在固定冷却后重试一次。第二次仍失败时，整道题的 Baseline/V0.1 配对 block 一起重跑；禁止只补跑表现差的一组。超过 5% block 出现基础设施无效，整个 Epoch 作废。

每个 run 的 Benchmark Receipt 保存：

```text
epoch_manifest_hash, run_id, question_id, group, repeat
start/end time, requested model profile, CLI version
prompt/corpus/tool/schema/environment hashes
raw JSONL, final JSON, exit status and artifact hashes
token usage, tool calls, files, source bytes and elapsed time
network/allowlist result
scorer version, score and failure classification
```

收据不得包含认证信息、账户标识、Token、Cookie 或其他秘密。

### 可选 Evidence Benchmark

原 64 题 × Baseline/CodeGraph/V0.1 三组 × 五次的 960-run 设计保留为历史方案，不自动运行。真正触发时必须新建决策票，重新确认当时可用的模型、CLI、工具版本、统计门槛、预算与服务漂移窗口；不得把旧 Smoke 与新 Evidence Benchmark 混为一个 Epoch。
