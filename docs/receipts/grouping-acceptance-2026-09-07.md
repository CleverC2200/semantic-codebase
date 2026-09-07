# 通用分组本地验收 · 2026-09-07

对应需求 #74 与票 #75–80。先完成独立源码核对点，再生成两个真实冻结样本；无专用业务映射，manual_mapping_count 均为 0。验收属于本地静态阅读，不是被索引应用运行验收。

| 样本 | 分析文件 | 已归属 / 定义 | 职责建议 | 已知 / 未知关联 | 分组耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| codegraph | 4 | 28 / 28 | 2 | 54 / 95 | 9 ms |
| poetry | 192 | 1378 / 1378 | 119 | 721 / 5317 | 70 ms |

以上仅单次本机测量（Node 24.14.1）；默认定义 10,000、关联 50,000、建议 200 的数量预算。10,800 定义夹具中归属 10,000，其余 800 完整保留，定向测试含构造约 60 ms；不声称 p95 或任意规模 SLA。Poetry 100/20/2 限制输出保留全部 1,378 定义，其中 1,278 未归类，6,018 关联未处理；界面标 partial / business unknown。

- codegraph: source HEAD `3860feaaa14a3376478281d10e2ff6064977c686`；Snapshot `6035ff72515e480e59119ca6eb03657cebaf78236c7224b07f36920a9ac961b8`；Overlay `e4abbc468f08daa3a36d0b54862527aedd7fd502f274d42fa1cf3eeea915b247`。
- poetry: source HEAD `3860feaaa14a3376478281d10e2ff6064977c686`；Snapshot `59d9da2f0d7782f0563beeee18d9d0d7dd9063a61167404d36a69eaddfeefcb3`；Overlay `bce9a4b26d9fcb96a80787771feaacab55386ed7413bcf2b87f7d498bee7daac`。

策略 reader-groups-v1；最终生成器与算法哈希、输入哈希和 Node 记录在本地产物 receipt.json。源码、Definition、Fact、Evidence 数组和 Snapshot/Overlay 在分组前后逐项一致，输入文件 SHA 与收据一致。没有默认模型调用、网络请求、样本执行或业务写入。

## 独立源码核对结论

- CodeGraph materializeKernelResult、tryKernelExtract 对共享 decodeExtractBuffers 的两条调用及一次导入得到原始 Evidence 支持；decode.ts 唯一主归属，使用方可反向跳转返回。没有把 loader 与 decoder 强行合为一个文件模块。
- kernel 两个不连通职责建议保持独立；这可能把完整内核职责拆分成多个阅读建议，不能从调用子图推定完整职责。layout.ts 的常量没有被语法定义模型抽为函数，文件仍可在源码导航阅读；没有编造其业务主线。
- Poetry repository_pool.py 的 22 个定义完整保留，add_repository 的行号 130–145、返回 self、has_repository 调用和字典更新与先读源码一致。cache.py 的 FileCache 与 ArtifactCache 两组缓存建议分别对应源码，未吞并到仓库池。
- `pool` 词元将 RepositoryPool 建议为支撑实现，其业务分类证据不足，人工不确认该建议；业务/支撑分类仍只是 heuristic。cache.py 与 repository_pool.py 在本次 Python 投影没有已解析外部使用方；源码中的共享意图不能替代缺失的解析 Evidence。
- 未对全部 119 个 Python 建议逐项判定正确率；重复词元建议与拆分仍需人工处理。零未归类只说明定义结构归属完整，不是业务理解完成。
- CodeGraph 全量 179 文件以及排除三个语法错误后的 176 文件均未通过现有 Ready 门禁，最终证据仅覆盖内核子目录 4 文件；详见生成前核对点。不把子目录验收写成全仓库索引通过。

## 桌面旅程与验证

在 Codex 内置浏览器、127.0.0.1:8773 同源本地页面执行，并对待提交树生成的 HTML 复验：

- 结构模块 → 目录 → 文件 → 折叠关联实现 → materializeKernelResult / decodeExtractBuffers；对象名称、源码行号及返回原模块正确。
- decode.ts 展开反向使用方 → index.ts → 返回 decode.ts；打开 L267 调用 Evidence 进入对应冻结源码。
- 使用 local-e2e 测试身份将 decode.ts 调整到“职责建议”；新目录同版本重生成读回“本机已确认”。缩小关联预算重生成后显示“需复核”，原记录保留。测试决定仅保存在此隔离本机 origin，不代表产品业务确认。
- Poetry 导航到 repository_pool.py → RepositoryPool.add_repository，核对参数 priority、输出 RepositoryPool、处理逻辑及 L130–145；预算页面显示 1,278 未归类并按文件折叠。
- 全量测试在隔离的待提交树执行一次，250/250；审查修复后在更新后的同一交付树运行分组、能力决定及 Python 签名定向测试 20/20，typecheck 通过，构建通过。
- Standards 审查发现并关闭 2 项：主线不得扩大模块成员；保持 llm_inferred / 未验证标识。Spec 审查发现并关闭 2 项：同名候选身份消歧；共享实现反向使用方入口。两轴定向复核均无剩余阻塞项。

## 复现

先 npm run build；本地 references 固定到上列 HEAD，用 grouping-inputs 下对应 JSON 作为范围：

```sh
node scripts/run-source-reader.mjs references/codegraph docs/receipts/grouping-inputs/codegraph.json .workspace/acceptance/new-codegraph-source
node scripts/run-reader-grouping.mjs .workspace/acceptance/new-codegraph-source/reader-data.json .workspace/acceptance/new-codegraph-groups
node scripts/run-source-reader.mjs references/poetry docs/receipts/grouping-inputs/poetry.json .workspace/acceptance/new-poetry-source
node scripts/run-reader-grouping.mjs .workspace/acceptance/new-poetry-source/reader-data.json .workspace/acceptance/new-poetry-groups
```

输出目录必须新建。生成、读取和重生成使用同一公开 grouping 入口；既有冻结分析可复用。原有无关工作树改动未纳入本次提交；没有 push、关闭 Issue、部署或 OA 真实环境动作。
