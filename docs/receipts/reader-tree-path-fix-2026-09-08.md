# 源码目录空白修复验收

日期：2026-09-08。本地修复，未发布。

## 问题与修复

交付客户端的目录树仍拼接 `packages/zod/src/v3`，导致 CodeGraph 的文件按钮携带不存在的路径，点击后出现“没有可查看文件”。初始文件加载正常，先前验证未覆盖真实目录点击。

目录显示根据 `sourceRoot` 裁剪，文件选择直接保留冻结数据中的 `file.path`。未改变分析数据、Snapshot、Overlay 或 Evidence。

## 验证

- 回归测试 `test/scripts/reader-tree-paths.test.ts`：CodeGraph、Zod、Python、混合根目录均保留真实文件身份和函数归属。旧交付客户端复现失败，修复后的工作区与实际交付客户端均通过。
- 外部 Chrome 复用原标签页，刷新 `http://127.0.0.1:8773/grouping-codegraph-full-delivery-20260908/acceptance.html`。
- 展开 `src/context`，点击 `index.ts`：显示正确路径、18 个函数，未出现空文件提示。
- 点击 `extractSymbolsFromQuery`：显示静态摘要与参数，并在源码侧栏展示 `src/context/index.ts` 的 L44 函数声明和完整函数正文。
- 切换 `formatter.ts`：显示正确路径和 8 个函数。

## 边界

以上为本地浏览器点击验收与路径回归，未执行被索引项目。AI 文件职责解释仍未生成，静态覆盖保持 partial。未穷举点击全部 179 个文件。

按用户要求暂停内置浏览器。另一个任务报告两次桌面应用崩溃与内置预览加载具有时间关联；本次未再次复现，不据此认定崩溃根因。外部 Chrome 扩展的 DOMSnapshot 获取超时后，使用同一 Chrome 的原生可访问性界面完成点击与源码核验。
