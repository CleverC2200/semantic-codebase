# Archify 展示闭环后续验收

本记录承接 `archify-reader-followup-2026-09-09.md`，覆盖 #97–#102 的当前实现。实现位于独立工作树 `codex/archify-reader-complete`；原工作区已有修改保留。实现提交 `219442e`，下载身份修复 `c82a3fe`。

## 实现与评审

- 阶段、正常／失败候选路径聚焦；异步、状态与恢复未知边界可见。运行观测按 Repository、Snapshot、Overlay、Execution 和 observation-set 摘要校验，独立于静态图。
- 节点与关系按需读取并核对 Definition、SourceFile、Evidence、Claim Basis 和 Coverage。版本／摘要失配停止加载；上次已核对详情及阅读位置保留。Behavior Fact 不提升 AI 说明的来源等级。
- JSON、HTML、投影证据、收据通过原生浏览器下载；完整输入身份隔离每条主线的四类下载。两个不同主线可以产生相同 HTML，但不会再覆盖彼此的证明或收据。
- Reader iframe 按文档流自适应高度，窄屏顶栏换行，图面支持键盘横向滚动，来源目录提供节点与关系入口。图规格使用有界布局，最多 12 个定义；不压缩或静默截断超限输入。
- Standards／Spec 两路独立评审发现同一项 P2：原下载目录只绑定 HTML 摘要。`c82a3fe` 修复后两路均复核解除，无剩余发现。此前两项 P1 已在 `4f99dc5` 修复并复核。

## 自动与浏览器证据

- 独立干净工作树在 `219442e` 完整测试 **315/315 通过、0 skipped**，typecheck 通过。其后的 `c82a3fe` 定向测试 **40/40 通过**，包含两主线相同 HTML、依次生成后分别重新读取收据及全部文件摘要／字节数的回归。构建产物来自本轮独立工作树构建。
- 三类图样例：真实仓库 hash.ts 的 3 个定义／2 条调用；只读 OA 授权主线的 1 个定义；合成 12 个定义／11 条调用。均通过 showcase **9/9**，以及 1440×900、1600×1000、1920×1080、2048×1320 浏览器 containment 检查。明暗主题截图由模型检查；这不是独立真人验收，也不代表任意图拓扑均能通过。
- 真实 hash 图在 Chrome 原生下载到 Downloads，HTML、JSON、projection 与 receipt 重新读取核对。HTML 为 795475 字节，SHA-256 `8649f89f38dd5c6d7b47347fa7094917c0f580e0048be0e9f4607d41479114fa`；JSON 为 2680 字节，SHA-256 `633d403d49a4583af191c58e9cb8f91512697d8b04150f0c64c2eabc384a7e17`。下载 JSON 经带正确 repo-root 的项目级 Archify 重新 deliver，9/9 通过，生成 HTML 与原下载逐字节摘要一致。首次遗漏 repo-root 的验证拒绝是预期来源保护，未绕过。
- 浏览器安全策略拒绝直接打开 `file://` 下载文件；未尝试绕过。自包含文件已经下载、字节核对并从 JSON 重新生成；本地文件 URL 再次打开仍未验证。
- 390×844 窄屏检查消除 Reader 顶栏横向溢出；图面滚动容器获得键盘焦点后 ArrowRight 确实改变 scrollLeft。内嵌文档高度按实际内容调整，来源目录仍可用。
- 最终 `c82a3fe` 浏览器合成协议样例验证：全部／正常／失败切换、步骤 6 聚焦、step0 按需 Evidence 加载、源码回跳与返回。返回后步骤 6 的 aria-pressed 仍为 true，step0 的版本与 Evidence 详情保留。合成 Observation 明确不是实际应用运行；错误版本、Execution、来源绑定和摘要拒绝由定向测试覆盖。

原始本地记录位于该工作树 `.scratch/archify-complete/`，包括 full-test-219442e.log、typecheck-219442e.log、focused-fix.log、hash-visual.json、oa-final-visual.json、twelve-final-visual.json、download-verification.json、download-redelivery.json，以及各样例对应的 visual-check PNG。原始 OA 源码与载荷不发布。

## 完成边界

#97–#101 的实现和上述本地检查已完成，可随 PR 合并关闭。#102 的自动桌面／响应式检查已完成，独立真人视觉与无障碍验收尚无收据，因此 #102 和父票 #96 保持未完成。直接重新打开下载文件受浏览器策略限制，不能标记为已验证。#94 新读者效果、#55 真实 Trace 及 #10 性能 Gate 仍按各自范围保留；本轮没有执行被索引应用、修改 OA 或把测试样例升级为真实运行。
