# 无专用映射的源码分组

从冻结阅读包生成结构模块、跨文件使用关系和职责建议；不改写 Snapshot / Semantic Overlay。默认离线，不调用模型，不执行被索引项目或读取其运行配置。

```sh
npm run build
# file-list.json 是源码相对路径数组，只限定分析范围；一次一种语言（.py 或 .ts/.tsx）。
node scripts/run-source-reader.mjs /absolute/repository file-list.json .workspace/acceptance/source-new
node scripts/run-reader-grouping.mjs .workspace/acceptance/source-new/reader-data.json .workspace/acceptance/groups-new
python3 -m http.server 8773 --bind 127.0.0.1 --directory .workspace/acceptance
```

在浏览器打开 `http://127.0.0.1:8773/groups-new/acceptance.html`，选择“业务能力”。按目录进入文件模块、展开关联实现、定位函数，再返回原模块；分组依据可打开对应冻结源码。已有阅读包可直接执行第二步；重生成使用新的输出目录和相同入口，无需重新分析。

结构模块为文件所有权投影，含辅助及孤立声明。跨文件调用/导入形成 uses，目标保留唯一主归属。职责建议需要相连声明名称与路径共同支持，保留 framework_heuristic、未验证状态；建议成员只引用结构模块，不复制主归属。同名词元的多个不连通组保持独立，具体业务含义仍需人工核对。源码无定义的文件仍在源码导航，不能从定义覆盖推断文件语义已被理解。

人工确认、调整上级和撤销沿用浏览器本机决定记录。仅同源、同仓库且版本和依据一致时读回确认；Snapshot、Overlay、成员、策略或预算变化会要求复核。已移除候选的历史保留，换浏览器或端口不会自动迁移本机记录。

预算参数：`--max-definitions=10000 --max-links=50000 --max-proposals=200`。这些是确定性的生成数量预算，不是总文件大小、解析内存或毫秒硬上限；输入解析、哈希和排序仍需遍历输入。超限定义保留在未归类列表，链接和建议记录截断数量，所有冻结定义仍可查找。默认值覆盖此次 1,378 定义真实样本并经 10,800 定义夹具验证；不构成任意规模性能承诺。缺失来源或无法解析的调用保留明确原因，结构覆盖与业务解释分别显示。

输出 `reader-data.json`、`receipt.json` 和 `acceptance.html`。收据记录输入哈希、Snapshot/Overlay、生成器哈希、Node、策略、预算、耗时和人工配置数量；生成对象不含时间戳。原人工配置保留在 manualMappings，不纳入自动覆盖。HTML 最多显示每组 50 条依据及每条 20 个证据，完整引用在 JSON。

本次独立源码核对点与验收边界见 [源码核对点](receipts/grouping-source-checkpoints-2026-09-07.md) 和 [本地验收](receipts/grouping-acceptance-2026-09-07.md)。
