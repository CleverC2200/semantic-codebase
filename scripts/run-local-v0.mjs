import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCli } from "../dist/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".workspace/acceptance/current-v0");
const repo = path.join(root, "benchmark/corpus/python");
const store = path.join(output, "python.sqlite");
mkdirSync(output, { recursive: true });
async function invoke(args, name) {
  let content = "";
  const code = await runCli([...args, "--repo", repo, "--store", store], { stdout: { write: (value) => { content += value; } }, stderr: { write: () => {} } });
  if (code !== 0) throw new Error(content);
  writeFileSync(path.join(output, name), content);
  return content;
}
await invoke(["index", "--profile", "semantic-v0"], "index-receipt.json");
await invoke(["ask", "--question", "build_registry 的调用路径是什么", "--format", "json"], "answer.json");
await invoke(["ask", "--question", "build_registry 的调用路径是什么", "--format", "markdown"], "answer.md");
await invoke(["sync"], "sync-receipt.json");
process.stdout.write(JSON.stringify({ repo, store, answer: path.join(output, "answer.md"), mode: "local_no_model_no_application_execution" }) + "\n");
