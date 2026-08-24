# 正式 Benchmark 的本地 Agent 运行环境

> **未采用**：用户随后决定不部署或维护本地模型。本文件仅保留为历史研究证据，不得作为安装或实施指令；当前路线见对应 Benchmark 契约与执行配置票。

> 对应票据：[研究正式 Benchmark 的本地 Agent 运行环境](../issues/14-research-local-agent-runtime.md)。
>
> 调研日期：2026-08-17。本文只引用模型或运行时的官方资料；许可证说明不是法律意见。

## 结论

正式 Benchmark 的主候选是 **`Qwen/Qwen2.5-Coder-7B-Instruct` + Ollama 本地 HTTP API**；将实际上下文限制为 **16,384 tokens**，单并发、固定采样参数、只开放受控的本地只读工具。它与本机 Apple M4、16 GB 统一内存的目标相称，模型是面向代码/Code Agent 的 7.61B 指令模型，Ollama 官方资料明确列出 Qwen2.5-Coder 的工具调用支持，并提供 JSON Schema、原生输入/输出 Token 计量及可固定的 `seed`/`num_ctx`。模型权重为 Apache-2.0，Ollama 源码为 MIT。[Qwen 模型卡](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct)；[Ollama 工具调用](https://ollama.com/blog/streaming-tool)；[Ollama 结构化输出](https://docs.ollama.com/capabilities/structured-outputs)；[Ollama 许可证](https://github.com/ollama/ollama/blob/main/LICENSE)。

降级候选是 **`Qwen/Qwen2.5-Coder-1.5B-Instruct` + 同一 Ollama 协议与 Agent runner**，上下文限制为 **8,192 tokens**。它保持代码专用 Qwen2.5-Coder 与 Apache-2.0 的许可边界，但参数量 1.54B、原生完整上下文 32,768，适合主候选无法在资源上稳定运行时继续做同协议的冒烟、工具/JSON 回归；它不是与主候选混合汇总的替代分数。[1.5B 官方模型卡](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct)。

这不是“已合格的现成环境”：本机目前未安装 Ollama、llama.cpp 或 vLLM，也没有已缓存的候选模型；本票没有下载、安装、修改系统或运行模型。因此下面的冻结字段必须在准入时填为实际版本、commit 和 SHA-256；缺任何一项都不得产出正式分数。

## 本机只读摘要与约束

| 项目 | 本次只读结果 | 对决策的含义 |
| --- | --- | --- |
| 机器 | Mac mini，Apple M4，10 CPU 核、16 GB 统一内存 | 不按 32B/70B 模型或超长 KV cache 设计正式单机配置；先以量化 7B 和受限上下文为上限。 |
| 系统 | macOS 26.5.2（build 25F84） | 必须进入环境 manifest；不记录序列号、UUID、用户名、路径或网络配置。 |
| 本地运行时 | 未发现 `ollama`、`llama-server`、`llama-cli`、`vllm` | 不能声称已验证 Metal 性能、工具成功率或输出稳定性。 |
| 相关 Python 包 | 未发现 `ollama`、`llama*`、`vllm`、`transformers`、`mlx`、`litellm` | 准入时须使用隔离、版本锁定的依赖，而非依赖全局环境。 |

`Qwen2.5-Coder-7B-Instruct` 官方模型卡给出 7.61B 参数、28 层、GQA（28 Q / 4 KV heads）和完整 131,072-token 能力；卡片也说明默认配置是 32,768，超过它才需要启用 YaRN。因此 16,384 不依赖长上下文外推，而是为 16 GB 机器保留 KV cache、运行时和评测进程空间的保守上限；不得把模型宣传的最大窗口误记为本 Benchmark 的实际窗口。[官方模型卡](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct)。

## 模型与运行时比较

| 候选 | 工具调用 / 结构化 JSON | 上下文与 Token | 确定性、许可证与本机判断 | 决定 |
| --- | --- | --- | --- | --- |
| Qwen2.5-Coder-7B-Instruct + Ollama | Ollama 的 `/api/chat` 接收 `tools`，`format` 可为 `json` 或 JSON Schema；官方博客将 Qwen2.5-Coder 列为支持工具的模型。 | 模型完整窗口 131,072；本配置冻结 16,384。`prompt_eval_count`、`eval_count` 分别为输入、输出处理 token。 | Ollama `seed` 用于可复现输出，`num_ctx` 控制上下文；模型 Apache-2.0、运行时 MIT。7B 是本机唯一合理的正式主候选，仍须先做准入验证。 | **主候选** |
| Qwen2.5-Coder-1.5B-Instruct + Ollama | 与主候选共用工具、JSON、runner 和日志契约。 | 模型完整窗口 32,768；本配置冻结 8,192，继续使用同一原生计量。 | 模型 Apache-2.0；体积和 KV 压力明显较小，但能力结论不能与 7B 混合。 | **降级候选** |
| Qwen2.5-Coder-7B-Instruct + llama.cpp `llama-server` | 官方 server 支持 OpenAI 风格 function calling（需工具感知 Jinja template）；可用 JSON Schema/GBNF 约束输出。 | `/v1/chat/completions` 提供 `usage`，另有 `/tokenize`；timings 可拆出 prompt、缓存和预测 token。 | `--seed` 可固定；项目为 MIT，且 Apple Silicon 是一等优化目标（NEON、Accelerate、Metal）。但正确的工具模板、GGUF 转换/量化产物与其 hash 都需额外冻结，实施变量比 Ollama 多。 | 可作为主候选的独立复现/故障诊断后备，不与正式 Ollama 分数混跑。 |
| vLLM + Qwen2.5-Coder-7B-Instruct | Qwen2.5 的官方资料给出 vLLM 的工具调用启动方式；Coder 模型卡给出其 OpenAI 兼容服务示例，但 Coder 的工具模板须另做候选专属验证。 | 可以固定模型 revision 与服务参数。 | vLLM 对 macOS Apple Silicon 是实验性 CPU 支持且需源码构建；官方 GPU 路线依赖社区维护的 vLLM-Metal/MLX。现有机器上没有该环境，安装和依赖面也大。 | 不作为 V0.1 主/降级候选。 |

能力依据：Ollama [chat API](https://docs.ollama.com/api/chat)、[用量 API](https://docs.ollama.com/api/usage)、[Modelfile 参数](https://docs.ollama.com/modelfile)；llama.cpp [server 文档](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)、[function calling 文档](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md)、[许可证/Apple Silicon 说明](https://github.com/ggml-org/llama.cpp)；vLLM [Apple Silicon 安装说明](https://docs.vllm.ai/en/latest/getting_started/installation/cpu/?device=apple) 与 [GPU 路线说明](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/)。

## 正式运行轮廓

### 主候选

- 模型源：`Qwen/Qwen2.5-Coder-7B-Instruct`，采用上游许可文件为 Apache-2.0 的固定 revision；不以“最新”别名、浮动 tag 或未记录的社区量化替代它。
- 推理：Ollama server 仅绑定 `127.0.0.1`，不启用云/网页搜索；每 run 独立会话、`num_ctx=16384`、单一 in-flight request。
- 采样：`temperature=0`、固定非随机采样/惩罚参数、固定 `seed`、固定最大输出 token；所有值进入 manifest。`seed` 是运行时提供的复现控制，不是跨版本、跨硬件或并发下 bit-for-bit 相同的保证。[Ollama 参数说明](https://docs.ollama.com/modelfile)。
- 输出：模型调用使用 JSON Schema；runner 在解析后再按 Benchmark 的 `answer`、`evidence[]`、`confidence` schema 校验。模型“生成了 JSON”不等于业务 schema 合格。
- 工具：只有 `list_files`、`read_file`、`search_text`、`codegraph_query`（仅 CodeGraph 条件）及固定的元数据工具；所有工具均限定为目标 checkout 的只读允许目录。禁止 shell、网络、进程管理、Git 历史、Gold、评测日志和任何写工具。
- 隔离：目标 checkout 只读；Gold/evaluator 仅给评分进程；运行网络 namespace 或等效出口策略默认拒绝；不得从工具描述或错误文本泄漏题库名称、Gold 或隐藏测试。

### 降级规则

只有在主候选的**资源/稳定性准入**失败（例如在冻结的 16,384 上下文与单并发下 OOM、超时或输出 schema 门槛不达标）时，才启用 1.5B 配置。启用后整套 64 题必须从头以 1.5B 重跑，并单独标明 `agent_profile_id`；不得用 7B 的前半批与 1.5B 的后半批拼成一个发布结果。主候选后来恢复时，也必须以完整的新 profile 重跑。

## 环境冻结清单

以下为正式 `environment.manifest.json` 的最小字段。`<待准入>` 不是可发布值；正式报告只接受已填值并验证 hash 的 manifest。

```json
{
  "schema_version": 1,
  "agent_profile_id": "local-qwen25-coder-7b-ollama-v1",
  "host": {
    "architecture": "arm64",
    "chip": "Apple M4",
    "memory_bytes": "<只记录总量>",
    "os_product_version": "26.5.2",
    "os_build": "25F84"
  },
  "runtime": {
    "name": "ollama",
    "version": "<待准入，禁止 latest>",
    "release_or_source_commit": "<待准入>",
    "binary_sha256": "<待准入>",
    "listen": "127.0.0.1",
    "network": "deny"
  },
  "model": {
    "upstream_id": "Qwen/Qwen2.5-Coder-7B-Instruct",
    "upstream_revision": "<40 位 commit>",
    "upstream_license_sha256": "<待准入>",
    "artifact_format": "<例如 GGUF 或 Ollama blob>",
    "quantization": "<精确名称>",
    "artifact_sha256": "<待准入>",
    "tokenizer_revision": "<待准入>",
    "tokenizer_files_sha256": "<待准入>",
    "chat_template_sha256": "<待准入>"
  },
  "inference": {
    "num_ctx": 16384,
    "max_output_tokens": "<待准入>",
    "temperature": 0,
    "seed": "<固定整数>",
    "top_k": "<固定值>",
    "top_p": "<固定值>",
    "repeat_penalty": "<固定值>",
    "parallel_requests": 1,
    "stream": false
  },
  "agent_and_tools": {
    "runner_commit": "<待准入>",
    "system_prompt_sha256": "<待准入>",
    "answer_schema_sha256": "<待准入>",
    "tool_schema_sha256": "<待准入>",
    "tool_allowlist": ["list_files", "read_file", "search_text", "codegraph_query"],
    "tool_response_byte_cap": "<固定值>",
    "tool_timeout_ms": "<固定值>"
  },
  "benchmark": {
    "corpus_manifest_sha256": "<待准入>",
    "target_checkout_commit": "<每题固定>",
    "evaluator_image_digest": "<待准入>",
    "run_count_per_case": 5
  }
}
```

额外保存每次模型调用的 `prompt_eval_count`、`eval_count`、耗时、完整请求/响应（脱敏后）、模型 digest、每项工具事件及返回的 UTF-8 字节数；另用上述冻结 tokenizer 对**模型输入**离线重算 token。这正好满足已定契约中“运行时原生 input/output token + 工具字节 + 固定 tokenizer token”三条口径，而不会把不同量化或运行时的原生计数误当成无条件可比的数字。[Ollama 用量说明](https://docs.ollama.com/api/usage)；[既定 Benchmark 契约](../issues/04-decide-benchmark-contract.md)。

## 准入与失效条件

在首次获准安装/下载后，先在非正式的干净隔离环境完成下列准入，才允许把 manifest 用于 64 题正式评测：

1. `ollama --version`、runtime 二进制 hash、模型 blob hash、上游 revision/许可、tokenizer 与 chat template hash 全部写入 manifest，且 `ollama show` 的模型信息与其一致。
2. 固定 16,384 的上下文、单并发、资源限制下完成冷启动和连续 10 次健康检查；不得 OOM、swap 异常或走向外部网络。记录冷加载与稳定的 prompt/generation 吞吐，但不以速度替代正确性。
3. 以冻结工具 schema 运行至少 100 次代表性工具调用和 100 次最终回答 JSON；最终 schema 解析失败率必须不高于已定契约的 1%。若模型工具调用的参数不合法，记为失败，不由 runner 悄悄修复后计成功。
4. 对同一固定输入连续 10 次保存规范化输出 hash；如果不一致，仍可按五次重复报告 Agent 波动，但不能称该 profile 为确定性，且应阻断“固定本地模型”的正式资格，直到将差异定位为未冻结参数、缓存/并发或运行时问题。
5. Baseline 与 CodeGraph 仅切换工具允许表；模型、runtime、上下文、提示、schema、超时、资源和 target checkout 必须相同。任何模型、量化、模板、runtime、系统 build、工具 schema 或资源上限改变，均产生新的 `agent_profile_id` 并从头重跑。

## 许可证与范围边界

- `Qwen2.5-Coder-7B-Instruct` 和 `Qwen2.5-Coder-1.5B-Instruct` 官方模型页均标为 Apache-2.0；每次下载/转换/再分发前仍须随冻结 revision 保存该模型的实际 `LICENSE` 文件 hash 与所用权重/量化的来源链。[7B](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct)；[1.5B](https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct)。
- Ollama 和 llama.cpp 的源代码均为 MIT；若实际打包、重分发二进制或包含第三方模型/组件，交付物仍应保留各自版权和许可证文本，不应把运行时 MIT 误扩展到模型权重。[Ollama](https://github.com/ollama/ollama/blob/main/LICENSE)；[llama.cpp](https://github.com/ggml-org/llama.cpp)。
- 本研究不授予下载、安装、云推理、上传源码或发布模型的权限。正式 Agent 仅向回环本地服务发送题面和被允许工具返回的内容；所有网络出口保持拒绝。

## V0.1 决策

冻结 **Qwen2.5-Coder-7B-Instruct + Ollama + 16,384 context + 单并发 + JSON Schema + 固定 seed/参数** 为正式 Benchmark 的主 profile；冻结同协议的 **Qwen2.5-Coder-1.5B-Instruct + 8,192 context** 为仅在主 profile 资源/稳定性失败时启用的降级 profile。下一张执行票应把此研究与冻结 Corpus 一起填成具体 artifact/runtime/version/hash，并执行准入；在此之前没有官方 Benchmark 分数。
