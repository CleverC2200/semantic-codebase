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


### Archify 展示投影

使用完整冻结阅读包和对应源码 Git 根目录启动本机阅读入口：

```sh
node scripts/serve-reader-archify.mjs /absolute/path/to/reader-data.json /absolute/path/to/source-repository
```

打开命令输出的本机 URL，在主线页选择“预览 Archify 图”。核对节点数、关系数、边界项、Coverage、Snapshot 和 revision 后，可下载 Archify JSON、投影证据、离线 HTML 与交付收据。选择图节点或关系按需核对 Evidence、Claim Basis、Coverage 和源码，再回到 Reader 中的正确定义；返回主线保留选中对象与阶段。普通离线 Reader 可准备并导出 JSON，HTML 生成需要上述本机入口或以下命令。

可选择全部路径、已有正常／失败结果标签对应的候选路径或单个阶段；这些阶段与路径仍为 `llm_inferred`、未验证。缺少结果标签时对应按钮不可用。Runtime Observation 单独展示，需通过 Repository、Snapshot、Overlay、Execution 与 observation-set 摘要校验；函数观测不证明阶段或整条路径执行。版本失配会停止来源加载并保留上次核对的详情。

桌面支持明暗主题；窄屏图面可以横向滚动或用左右方向键移动，并有可直接操作的节点／关系来源目录。单图预算为 12 个定义，超限明确拒绝，尚不支持自动拆分大型主线。四类下载使用包含主线身份的输入摘要隔离，即使不同主线生成相同 HTML，也不会覆盖彼此的证明或收据。

命令行交付到一个新目录：

```sh
node scripts/render-reader-archify.mjs /absolute/path/to/reader-data.json MAINLINE_ID /absolute/path/to/new-delivery /absolute/path/to/source-repository
```

目录内的 diagram.html 是自包含展示，diagram.archify.json 可直接交给项目级 Archify；projection.json 保留 Definition 身份、完整 Evidence 和 unknown，receipt.json 绑定输入、版本、工具与输出摘要。旧版“单独传 spec.json”的包装命令不再支持：只有 Archify 规格不能证明 Semantic Evidence Closure。

生成器核对源文件摘要与指定 Git revision，不以当前 HEAD 替代旧版本。旧阅读包可使用旁边的 receipt.json 恢复来源身份，但 Snapshot、Overlay 与完整文件清单必须吻合；目录样本缺少真实 revision 时不能导出来源已核对的 Archify 图。

已有中文 OA 架构图需要复现桌面阅读修复时，使用独立的 [OA 桌面 renderer 配置](oa-architecture-desktop.md)。它通过新目录和摘要清单保存经过审阅的工具副本，显式启用，不改变这里的默认 Reader 导出。

本轮最多展示 12 个绑定节点，超出预算会明确拒绝，要求更小的来源绑定主线。未解析、候选、partial 与运行观测不补画为确定连线；阶段始终标记为未验证推断。生成失败不覆盖任何已交付目录。服务只监听 127.0.0.1，只处理固定包内主线 ID；不执行被索引应用、不调用模型，也不接收任意源码或命令。结束预览可用 Ctrl-C 停止服务。

HTML 交付、自动浏览器检查和视觉检查是三份独立证据，不能互相替代；具体结果与限制见 [本轮收据](../receipts/archify-reader-followup-2026-09-09.md)。
