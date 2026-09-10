# OA 架构图桌面阅读配置

此入口保存已完成审阅的 OA 架构图桌面修复，让后续生成可复现相同的 renderer。它显式准备一个独立副本，适用于中文 OA 架构图；不会更新已安装 Archify，也不会自动改变 Reader 的默认导出。

配置包括图外模块类型图例、可展开的 14px 文字阅读、来源信息完整展示、搜索清空与 Escape 焦点恢复、明暗对比度修正，以及“看审批主线、查看模块来源、理解写入边界”三个指南入口。文字列表从图中的节点、关系和来源派生，保留原有方向和版本；SVG 全图概览仍会缩放。

## 适用范围

- 使用 `architecture` 和 `meta.locale: "zh-CN"`。指南中的 `entry`、`writer`、`oa` 必须分别表示授权入口、唯一写入节点和 OA 目标，并有输入事实支持的关系。此配置不是任意图或其他语言的通用主题。
- 使用自己已核对的 JSON、固定 Git revision 和对应源码根目录。准备 renderer 不核对 OA 事实，后续 `deliver --repo-root` 才验证声明的来源；静态来源核对不代表应用运行或业务审批通过。
- 安装基线为本配置核对过的 Archify 2.17 文件组合。即使版本号相同，只要清单中的文件摘要变化，准备命令也会拒绝应用，需重新评审后更新清单。
- 验收范围为桌面。旧产物已有的窄屏样式保留，手机端没有纳入本轮验收。没有完成全套屏幕阅读器、200% 缩放、全部高级预设或导出格式认证。

## 复现

需要 Node 24、Git 和本地已安装的匹配 Archify。以下路径为示例；替换安装目录、输入 JSON 与 OA 源码根目录。输出父目录必须存在，renderer 输出目录必须是新的，并位于安装目录之外。

```sh
mkdir -p .workspace/oa-desktop
node scripts/prepare-oa-archify-renderer.mjs /path/to/archify .workspace/oa-desktop/renderer
node .workspace/oa-desktop/renderer/bin/archify.mjs deliver architecture /path/to/oa-architecture.json .workspace/oa-desktop/diagram.html --repo-root /path/to/oa-source --quality showcase --json
node .workspace/oa-desktop/renderer/bin/archify.mjs visual-check .workspace/oa-desktop/diagram.html --json
```

每次交付使用新的输出位置。仅在 `deliver` 退出成功、收据报告 9/9、0 error、0 warning 后检查该 HTML；失败时不得将旧输出当作新结果。交付后的 HTML 保持冻结，修改应回到输入或 renderer 源码后重新生成。

准备命令只读取清单中 58 个已绑定摘要的普通运行文件，拒绝符号链接文件和不匹配内容；不复制安装目录内额外的配置、凭据、研究样本或缓存。它先在临时目录应用补丁并核对全部输出摘要，成功后发布新目录，写入 `desktop-profile-receipt.json`。不会执行安装脚本或被索引应用。

## 维护

源码修改以 [renderer.patch](../../scripts/archify-oa-desktop/renderer.patch) 保存，覆盖五个 renderer 文件；[manifest.json](../../scripts/archify-oa-desktop/manifest.json) 同时绑定基线、补丁及结果摘要。没有提交生成 HTML、OA 输入 JSON 或整个工具安装目录。

更新时，在独立 renderer 副本中修改、生成并验证产物，再生成可读的 unified diff 和新摘要。补丁按原始字节保留上下文与空白，专用 `.gitattributes` 仅排除此补丁载荷的空白检查，准备程序仍核对每个结果文件摘要。派生自 Archify 的补丁保留 [MIT 许可](../../scripts/archify-oa-desktop/LICENSE.archify)。

运行定向测试：

```sh
ARCHIFY_TEST_ROOT=/path/to/archify node --import tsx --test test/scripts/oa-archify-renderer.test.ts
npm run typecheck
```

未指定 `ARCHIFY_TEST_ROOT` 时，集成用例查找项目级 `.agents/skills/archify`，未安装则明确跳过；目录保护和基线失败用例仍运行。发布此配置时须在匹配安装上执行集成用例，并查看 [本次交付记录](../receipts/oa-architecture-desktop-2026-09-10.md)。
