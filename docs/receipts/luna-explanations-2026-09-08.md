# CodeGraph 中文解释补齐验收

2026-09-08，本地交付。用户明确授权当前冻结源码发送至 Codex 模型服务，并指定 Luna high。

## 结果

- `gpt-5.6-luna`，`model_reasoning_effort=high`。
- 文件职责、项目角色和范围说明：179 / 179。
- 函数与方法的功能、参数含义、输出和处理逻辑：2260 / 2260。
- 91 个最终批次均通过文件集合、定义键集合、参数名和中文字段完整性检查；未发现占位说明或重复定义。
- 模型调用禁用工具，日志审计未发现工具活动。两类预期启动提示按仓库既有精确哈希规则分类，未当作工具执行。
- 按定义键及源码哈希绑定，所有展示解释标记 `llm_inferred`、`verified=false`。抽查修正了 formatter 文件范围描述中的一处过度断言，原始模型结果保留。

## 不变边界

- Snapshot：`546de0ef32493c3b8e9838a0a6163ad398dc98b7452d7c996c3707078b026bac`。
- Overlay：`2420371e34027d16ce18a806eb44f552db3769158083305bafea89c48b62fa26`。
- 原始 reader-data SHA-256：`9f8c49af5457191cd5224e601918c7dc8aae7c4dfb4f2f3bdb95358ca114dc5a`。
- 补齐展示后的 reader-data SHA-256：`946ce55370cf361a6ac257ca7e5079322645a0470a6e6dce6dfd435729ca0da6`。
- HTML SHA-256：`bd24363435e027e41688daff257de6a820de54bf12f36df91ecb67668b587732`。
- 移除新增 presentation 后，完整数据对象与原始对象逐项相等；源码哈希全部匹配。未重新索引或执行被索引项目，覆盖仍为 partial。

## 浏览器验收

仅使用外部 Google Chrome 原标签页，未操作内置浏览器。

1. `src/bin/codegraph.ts` 显示文件职责、项目角色和 24 个函数中文简介。
2. 点击 `src/context/index.ts`，显示该文件的职责、项目角色和 18 个函数中文简介。
3. 点击 `extractSymbolsFromQuery`，显示功能、query 输入、返回值和处理逻辑，旁边仍是原 L44–133 源码；保留 AI 说明未验证标记。

## 本地产物

目录：`.workspace/acceptance/grouping-codegraph-full-delivery-20260908/`。

- `acceptance.html`：原地址更新后的预览。
- `reader-data.with-explanations.json`：补齐后的展示数据。
- `luna-explanations.json`：含版本绑定的解释侧文件。
- `explanation-receipt.json`：覆盖、调用审计、源码抽查、修正和生成器记录。
- `explanation-browser-receipt.json`：外部 Chrome 验收记录。
- `acceptance.before-explanations.html`：更新前预览备份；原始 `reader-data.json` 与 `receipt.json` 保留。

生成与核验脚本、分批结果和重试记录在 `.scratch/general-grouping/luna-explanations/`。生成过程的标识抄写、分组格式及一次输出约束代码错误均被校验拦截；错误结果未写入预览。

完整性核验覆盖所有条目，语义正确性仅做源码抽查与浏览器抽查；不声称每条解释均经独立语义审查或真实运行验证。本次只补充本地展示数据，未推送或部署。
