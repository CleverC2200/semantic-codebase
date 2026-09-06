import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, PythonTreeSitterAdapter, SemanticRepositoryEnricher,
  buildContextPackage, answerContextPackage, sha256Bytes } from "../dist/index.js";
import { renderAnswerMarkdown } from "../dist/context/markdown.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".workspace/acceptance/release-review");
mkdirSync(output, { recursive: true });
const inputs = readFileSync(path.join(root, "test/semantic/semantic-journeys.test.ts"), "utf8");
const ts = /typescript: `([\s\S]*?)`,\n  python:/.exec(inputs)?.[1];
const py = /python: `([\s\S]*?)`,\n};/.exec(inputs)?.[1];
assert.ok(ts && py, "Order fixture source must be available before creating a review packet");
const cases = [], comparison = [], corpora = [];
const journeys = [
  ["main", "项目提供什么能力", "导出函数不等于人工确认业务能力"],
  ["main", "main 能否确认是业务能力", "没有人工 Decision 的候选不能自动确认"],
  ["main", "main 功能如何实现", "先检查 flag，再 normalize，最后 save"],
  ["save", "save 功能如何实现", "写入 store.last／store['last'] 并返回 value"],
  ["main", "main 的调用路径", "main → normalize；main → save，方向不能反转"],
  ["normalize", "normalize 的调用路径", "normalize 不调用 main"],
  ["normalize", "normalize 的数据流", "输入 value，返回 value + 1"],
  ["save", "save 的数据流写到哪里", "输入 value 写到 store 的 last 字段"],
  ["main", "main 有哪些条件和异常", "flag 为假时抛异常，不执行后续保存"],
  ["save", "save 的副作用", "store 状态写入，不是纯函数"],
  ["normalize", "修改 normalize 的影响范围", "直接调用者 main；不能凭同文件把 save 判定为调用者"],
  ["save", "修改 save 的影响范围", "直接调用者 main"],
];

for (const [language, text] of [["typescript", ts], ["python", py]]) {
  const name = language === "python" ? "order.py" : "order.ts";
  writeFileSync(path.join(output, name), text);
  const corpus = analyze(`order-${language}`, [{ name, text, language }]);
  for (const [symbol, question, note] of journeys) ask(corpus, name, symbol, question, note, cases);
}
const zodFile = "packages/zod/src/v3/helpers/parseUtil.ts";
const zod = analyze("zod-review", [read("references/zod", zodFile)]);
const zodData = buildContextPackage({ state: zod.state, overlay: zod.overlay, question: "addIssueToContext 的数据流",
  definition_key: zod.state.graph.definitions.find((item) => item.name === "addIssueToContext").definition_key });
const zodAnswer = answerContextPackage(zodData);
writeFileSync(path.join(output, "zod-data-chain.json"), JSON.stringify({ context: zodData, answer: zodAnswer }, null, 2));
writeFileSync(path.join(output, "zod-data-chain.md"), renderAnswerMarkdown(zodData, zodAnswer));
for (const [symbol, note] of [
  ["makeIssue", "检查路径拼接、显式 message 与 errorMap 分支"],
  ["addIssueToContext", "检查 makeIssue 调用及 ctx.common.issues.push 写入"],
  ["mergeArray", "检查 aborted、dirty 与数组聚合结果"],
  ["mergeObjectAsync", "检查 await 后委托 mergeObjectSync 的路径"],
  ["mergeObjectSync", "检查 aborted、dirty 与 __proto__ 排除条件"],
]) for (const question of [`${symbol} 的调用路径`, `${symbol} 的条件和副作用`]) ask(zod, zodFile, symbol, question, note, cases);

const poetrySubjects = [
  ["src/poetry/console/commands/run.py", "run_script", "检查命令选择与 env.execute；外部环境未冻结时不能宣称完整分派"],
  ["src/poetry/console/commands/check.py", "handle", "检查配置校验与错误退出；第三方验证器需保留未知"],
  ["src/poetry/installation/installer.py", "run", "检查 _do_refresh 与 _do_install 分支，以及 _update 状态修改"],
  ["src/poetry/factory.py", "create_poetry", "检查 Poetry 创建和配置加载；不要把名称推断当执行事实"],
  ["src/poetry/utils/env/env_manager.py", "create_venv", "检查虚拟环境选择、版本检查与创建边界"],
];
const poetry = analyze("poetry-review", poetrySubjects.map(([file]) => read("references/poetry", file)), {
  pythonVersion: "3.12", extraPaths: ["src"],
});
for (const [file, symbol, note] of poetrySubjects) for (const question of [`${symbol} 的调用路径`, `${symbol} 的条件和副作用`]) ask(poetry, file, symbol, question, note, cases);

const ownSubjects = [
  ["src/indexing/indexer.ts", "buildIncremental", "复用未变语法 Slice，配置变化仍改变 Snapshot"],
  ["src/semantic/overlay.ts", "validateSemanticInput", "校验 Snapshot、源码字节和配置身份后才能分析"],
  ["src/runtime/trace-runner.ts", "runTrace", "只有显式命令可运行；过期源码阻止执行"],
  ["src/context/evidence-answer.ts", "buildContextPackage", "查询消歧、证据闭合、预算与 unknown 不能丢失"],
  ["src/runtime/capability-registry.ts", "decide", "显式决定、版本冲突、事务及跨快照复核"],
];
const own = analyze("self-review", ownSubjects.map(([file]) => read("", file)));
for (const [file, symbol, note] of ownSubjects) for (const question of [`${symbol} 的调用路径`, `${symbol} 的条件和副作用`]) ask(own, file, symbol, question, note, cases);

const cgSubjects = [
  ["src/extraction/kernel/loader.ts", "getKernel"],
  ["src/extraction/kernel/loader.ts", "kernelSupports"],
  ["src/extraction/kernel/decode.ts", "decodeExtractBuffers"],
];
const cg = analyze("codegraph-comparison", [...new Set(cgSubjects.map(([file]) => file))].map((file) => read("references/codegraph", file)));
for (const [file, symbol] of cgSubjects) for (const question of [`${symbol} 的调用路径`, `${symbol} 的条件和副作用`]) ask(cg, file, symbol, question, "仅对照本地参考源码；未执行 CodeGraph 引擎，不能宣称与其输出一致", comparison);
assert.equal(cases.length, 54); assert.equal(comparison.length, 6);
const receipt = { schema_version: 1, created_at: new Date().toISOString(), author: "implementation-agent",
  status: "draft_requires_independent_review", independent_gold_passed: false,
  independently_verified: 0, release_cases: cases, comparison_cases: comparison, corpora,
  warning: "Source notes and observed answers are developer-authored review material, not independently verified expected answers or precision/recall measurements." };
writeFileSync(path.join(output, "review-packet.json"), JSON.stringify(receipt, null, 2));
writeFileSync(path.join(output, "review.md"), ["# V0 验收待复核包", "", "54 道 Release 题 + 6 道对照题已执行本地查询；独立通过数仍为 0。", "",
  "下列源码核对提示由实现方编写，不是独立标准答案。请逐题核对实际调用方向、条件、值来源、副作用和 Evidence，再填写独立 verdict。", "",
  ...[...cases, ...comparison].flatMap((item) => [`## ${item.id} · ${item.question}`, "", `语料：${item.corpus}；源码：${item.file}:${item.line}`, "", item.source_review_note, "", `当前状态：${item.status}；查询输出：${item.result_file ?? "无"}`, ""]),
].join("\n"));
process.stdout.write(JSON.stringify({ output, release_cases: cases.length, comparison_cases: comparison.length, independently_verified: 0 }) + "\n");

function read(reference, name) {
  return { name, text: readFileSync(path.join(root, reference, name), "utf8"), language: name.endsWith(".py") ? "python" : "typescript" };
}
function analyze(id, inputs, pythonConfig) {
  const source = { repository_id: id, files: inputs.map((item) => {
    const source_bytes = Buffer.from(item.text);
    return { relative_path: item.name, language: item.language, source_bytes, source_digest: sha256Bytes(source_bytes) };
  }) };
  if (pythonConfig) { const source_bytes = Buffer.from(JSON.stringify(pythonConfig)); source.configuration_files = [{ relative_path: "pyrightconfig.json", source_bytes, source_digest: sha256Bytes(source_bytes) }]; }
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter(), new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new SemanticRepositoryEnricher().enrich({ state, source });
  corpora.push({ id, snapshot_id: state.snapshot_id, source_manifest_digest: state.source_manifest_digest, files: state.manifest.files, coverage: overlay.coverage, facts: overlay.facts.length });
  return { id, state, overlay, inputs };
}
function ask(corpus, file, symbol, question, note, destination) {
  const definition = corpus.state.graph.definitions.find((item) => item.file_path === file && item.name === symbol);
  assert.ok(definition, `${corpus.id}: missing ${file} :: ${symbol}`);
  const id = `${destination === comparison ? "comparison" : "release"}-${String(destination.length + 1).padStart(2, "0")}`;
  const text = corpus.inputs.find((item) => item.name === file).text;
  const line = Buffer.from(text).subarray(0, definition.name_span.start_byte).toString().split("\n").length;
  try {
    const context = buildContextPackage({ state: corpus.state, overlay: corpus.overlay, question, definition_key: definition.definition_key, max_facts: 60 });
    const answer = answerContextPackage(context);
    const result_file = `${id}.json`;
    writeFileSync(path.join(output, result_file), JSON.stringify({ context, answer }, null, 2));
    destination.push({ id, corpus: corpus.id, file, line, question, source_review_note: note, status: "executed_pending_review", result_file, independent_verdict: null });
  } catch (error) { destination.push({ id, corpus: corpus.id, file, line, question, source_review_note: note, status: "query_failed", error_code: error.code ?? "ERROR", independent_verdict: null }); }
}
