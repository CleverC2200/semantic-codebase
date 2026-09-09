# Archify 阅读与交付补齐

本轮处理 #97、#98、#101 的实现阻断，并定位 preview:semantic 的输出指纹差异。基线为 PR #103 合并提交 `7f200b7`。本地实现与静态阅读验证不等于真人阅读或 OA 真实运行验收。

## 实现

- 投影逐项核对当前主线、阶段引用、Definition、源码摘要、声明范围、Evidence Closure、调用点和版本。调用点出现冲突目标时不生成确定连线；unresolved、主线外目标、未验证来源、候选不可用、partial Coverage 和未投影运行观测分别记录。
- Definition 身份、完整 Evidence 引用、Claim Basis、来源行号与边界放入独立投影证据文件，Archify JSON 保持官方 schema。12 个节点为本轮展示预算；超出时明确拒绝，要求更小的来源绑定主线，不静默截断。
- 增加固定阅读包的本机 HTTP 入口，直接进入主线。浏览器只提交主线 ID；源码与语义事实不上传、不执行。首屏使用既有按需加载分片。图节点可回到相同版本的源码，返回时保留选中对象。
- 命令行交付从完整 reader-data.json 重建投影，核对每份涉及源码与指定 Git revision 的 blob。旧阅读包只有在旁边收据的 Snapshot、Overlay 和完整文件清单吻合时才能补回 revision，不使用当前 HEAD 猜测。
- 新目录原子发布 HTML、Archify JSON、投影证据及统一收据。收据绑定 Snapshot、repository revision、投影器版本与代码摘要、输入摘要、Archify 身份、规格和 HTML 摘要及数量。已有目录一律不覆盖；渲染失败不留下半套交付。

## Gold 差异诊断

保持现有源码、锁文件、编译器和 grammar，使用 `TypeScriptTreeSitterAdapter({definitionsQuerySource})` 只切换 `dde6210` 的旧 Query 与当前 Query：旧 Query 的 symbol_type 为 431，新 Query 为 433，其余各类 Fact 数量一致。两处新增抽象类是冻结 Zod types.ts 的 `ZodType`（L158）与 `Class`（L5035），同时修正其成员的类归属。来源是已合并的抽象类抽取修复 `2849d00`。

grammar 后续由 `0.23.2-scb.1` 更新为 `0.23.2-scb.2`（`931b51e`），其身份参与 Snapshot。Snapshot/Definition 变化继续影响 Overlay、运行观测集合摘要及有预算的 Context Package 选择。本次 TypeScript Fact 总数 4330 → 4332，Context Fact 46 → 42；Python 指纹完全不变，运行样例仍为 2 observations / 1 candidate。

旧代码归档在当前共享 grammar 下被身份门禁拒绝，因此未宣称完整复现旧工具链，也没有绕过该门禁。上述 Query 差分是当前 grammar 下的受控实验。新的 benchmark/gold/semantic-preview-v0.json 仅是经过来源核对的输出回归指纹，不能替代独立正确性验收。

`npm run preview:semantic -- --output=<新目录>` 已成功执行；新增显式输出目录选项保留原冻结预览。独立语义、真实 Trace 与性能决策仍按 #55、#10 跟踪。

## 本地证据与边界

- 使用当前产品真实 src/contract/hash.ts 的冻结分析：主线 canonicalHash / canonicalJson / sha256Text，3 个定义、2 条已解析调用，所有源文件与 `7f200b7` 的 Git blob 一致。
- 使用既有 OA 冻结 reader-data 与其来源收据核对历史 revision，authorization 和 next-action 主线可交付；未修改旧 JSON、Snapshot 或 Overlay，未运行 OA 应用。
- 投影和交付定向验证覆盖缺少/失配证据、冲突目标、源码字节与 Git 不一致、旧目录保护、失败不发布、摘要回读、本机请求身份及首屏无全量源码/Fact/Evidence。
- 浏览器已走通主线 → Archify 图 → canonicalHash 正确源码 L48–50 → 返回原主线，保留选中节点。HTML 下载按钮调用无报错，但内置浏览器未返回 download 事件，不能据此宣称浏览器下载落盘已验证；服务产物字节与收据回读已验证。
- 首次 showcase 通过后，截图发现下方跨节点连线被默认画布裁切；修正为小主线两列布局、显式画布及诊断要求的标签位置。机器校验与实际截图检查分别记录，历史失败产物不冒充最终版本。
- 完整 #99 路径/运行观测分层、#100 关系 Evidence 面板与版本失配旅程、#102 全范围多尺寸/无障碍验收仍需后续工作。本轮不自动关闭这些票。

最终两列候选的 deterministic showcase 为 9/9，但 visual-check 检测到桌面纵向溢出：1440×900 的 scrollHeight=1222，1600×1000 / 1920×1080 为 1348，2048×1320 为 1376。此视觉状态为 failed，不使用上一候选的机器通过记录代替。#102 保持未完成。投影/交付当前定向测试 25/25 通过；来源 CLI 回归另外 2/2 通过。
