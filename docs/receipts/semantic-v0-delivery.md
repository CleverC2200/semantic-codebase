# Semantic V0 交付范围与边界

本次交付整合此前本地的 Syntax、Structural Graph 产品化提交与 Semantic V0 预览实现。

## 当前可运行链路

- Tree-sitter TypeScript/Python 结构抽取、确定性解析与增量 parity。
- SQLite Ready Snapshot、Definition/Evidence 查询、有界遍历与路径、CLI/MCP 查询一致性。
- TypeScript Compiler 语义摘要、基础控制步骤、副作用及源码顺序主线。
- Python Pyright CLI 检查、声明类型摘要及已有结构关系转换。
- 冻结 OTLP JSON 导入、能力候选、有限 Context Package、本地答案与可选 Codex 文本润色。

## 验收边界

- 通过测试表示已覆盖用例可运行，不表示完整语义理解能力已实现。
- 当前主线是源码顺序步骤，尚无完整 CFG、def-use 或跨过程数据流；框架入口识别尚未覆盖原计划中的 Express/FastAPI。
- Python 当前从声明文本提取类型摘要，从已有结构图读取调用/导入关系。Pyright 用于检查诊断，尚未通过 Type Server 取得类型、引用和调用绑定；不能把这些摘要等同于 Pyright 推断结果。
- `benchmark/corpus/runtime/zod-parse.otlp.json` 是人工构造的导入测试样例，不是真实执行 Zod 得到的观测证据。
- Context 的四类意图目前共享有限事实筛选和摘要，尚不构成完备的调用路径及影响分析。Codex 输出的 ID、状态和 Coverage 受本地约束，文本内容仍需人工检查。
- Preview Gold 是当前冻结输出的回归基线，不是独立标注的语义正确性评分。
- #10 的 V0.2 性能复测仍未通过原预算，保持打开；预览分析的 10 秒预算不能替代该性能门禁。

## 本地验证

交付整理时重新执行 typecheck、61 项测试、build 与 diff 检查，通过。
Zod Prototype Gate 单独复跑；机器收据位于本地 `.workspace/acceptance/zod-prototype/receipt.json`。
参考项目、数据库、验收 HTML、依赖和代理工具不进入公开 Git 仓库。
