# 研究正式 Benchmark 的本地 Agent 运行环境

Type: research
Status: resolved
Blocked by: 04
Parent: [找到 Semantic Codebase V0.1 的可实施路径](../map.md)

## Question

在源码不发送外部模型、单机可复现和固定版本的约束下，核对当前本机硬件，并比较适合 TypeScript/Python 代码理解 Benchmark 的本地模型、推理运行时、工具调用/结构化 JSON 支持、上下文长度、确定性控制、Token 计量和许可证。给出一个主候选、一个降级候选及完整运行环境冻结清单；不要下载模型或修改系统。

研究结果写入 `../research/local-agent-runtime.md`，外部能力与许可证只引用模型或运行时官方资料，本机信息只记录完成决策所需的非敏感摘要。

## Comments

## Answer

主候选为 `Qwen/Qwen2.5-Coder-7B-Instruct + Ollama`，实际 context 固定为 16,384、单并发、固定采样与 JSON Schema；降级候选为同协议的 1.5B 模型、8,192 context。当前 Mac M4/16 GB 未安装任何候选运行时或模型，因此本结论是待准入的冻结方案而非已认证环境；正式执行前必须填实 runtime、模型、tokenizer、模板和工具的版本/hash，并通过资源、JSON、网络隔离与稳定性门槛。详见[研究资产](../research/local-agent-runtime.md)。

## Disposition

该研究事实保留，但用户随后决定不部署或维护本地模型。本方案已移出地图的 Decisions so far，并进入 Out of scope；不得据此安装 Ollama、下载模型或配置本地推理环境。
