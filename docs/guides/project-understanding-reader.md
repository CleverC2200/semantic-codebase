# 项目理解与需求核对阅读包

阅读包把项目总览、中文用途搜索、源码支持的候选主线和需求核对表放到同一离线页面。结构、Evidence 和版本仍来自冻结分析；导览和规则判断属于未验证的 presentation。整理自源码的规则不等于外部业务规格，源码支持不等于运行通过。

## 生成与打开

使用 package.json 指定的 Node 与锁文件依赖，先执行 `npm run build`。准备已有的完整 reader JSON，显式选择与该 Snapshot 匹配的导览目录：

```bash
node scripts/run-reader-guide.mjs \
  /absolute/path/reader-data.with-explanations.json \
  scripts/reader-guides/codegraph.json \
  .workspace/acceptance/project-understanding-new
```

输出目录必须不存在，防止覆盖历史验收。此命令只读取指定 JSON，不索引或执行被分析项目，不调用模型。内置 CodeGraph 目录只适用于其中声明的冻结版本，源码或 Snapshot 不匹配时拒绝生成。

输出包括 `acceptance.html`、`reader-assets/`、`requirements.json` 和 `receipt.json`。应一起保留。通过本机 HTTP 服务打开 HTML；直接用 `file://` 打开时浏览器可能阻止资源读取。

```bash
python3 -m http.server 8773 --bind 127.0.0.1 --directory .workspace/acceptance
```

启动前核实端口及已有服务目录，已有对应服务时直接复用。浏览器打开 `http://127.0.0.1:8773/project-understanding-new/acceptance.html`。默认只请求当前包内的相对资源，不访问外部站点。旧的完整内嵌 reader 包仍可渲染。

## 阅读与核对

- 项目总览提供候选能力和推荐入口；缺少有效导览时保留完整源码目录。
- 中文搜索覆盖说明、主线和有版本绑定的别名。结果是相关实现；不支持的问题显示相关对象，不伪装成已确认答案。
- 函数说明与源码先可读，Fact、调用关系、风险和完整控制流在需要时加载。紧凑步骤只合并直线语句，保留原始 Evidence 入口；复杂函数可切换完整图。
- 需求核对支持导入条款、记录判断/条件/理由/函数依据、保存本机和导出。浏览器存储由当前 origin 隔离；导出是跨浏览器交接方式。关闭或清理浏览器存储前应自行保留导出文件。
- 验证产物必须携带条款、仓库、Snapshot、Overlay、定义与产物摘要绑定。导入的本地测试或运行观测没有在阅读器中重新执行。运行观测还须对应冻结包中的有效观测集合及执行 ID。
- 条款、源码、定义或版本变化会使旧判断待复核；反向判断或失败验证保留冲突。旧记录不会被新结论悄然覆盖。

## 完整性与限制

版本化清单绑定每片内容的摘要、大小、种类和版本。缺片、加载失败或摘要错配时保留原阅读位置，明确报错并可重试；不从其他版本补齐。完整导出/变更比较会先恢复全部资源，代价高于普通阅读。

分片降低首屏载荷，但含关联 Evidence 的函数分片会增加总包体积。Coverage 和 unknown 沿用原包；恢复完整 Fact 只证明传输与原派生结果一致，不证明原抽取绝对正确。

`#94` 的新读者验收必须另行记录真人参与、时间和误解。自动点击、模型复核及搜索用例都不能替代真人阅读，也不能证明被索引应用的真实运行。
