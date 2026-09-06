import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const stdlibRoot = path.join(path.dirname(input.server), "dist", "typeshed-fallback", "stdlib");
function stdlibIdentity(file, range) {
  const relative = path.relative(stdlibRoot, file).split(path.sep).join("/");
  if (!["builtins.pyi", "typing.pyi", "subprocess.pyi", "pathlib.pyi", "pathlib/__init__.pyi", "sqlite3/dbapi2.pyi", "sqlite3/__init__.pyi", "urllib/request.pyi", "http/client.pyi"].includes(relative)) return null;
  const lines = readFileSync(file, "utf8").split("\n");
  const name = lines[range.start.line]?.slice(range.start.character).match(/^\w+/)?.[0];
  if (!name) return null;
  let owner = "";
  const declarationIndent = lines[range.start.line]?.match(/^\s*/)?.[0].length ?? 0;
  for (let line = range.start.line - 1; line >= 0; line--) {
    const declaration = /^(\s*)class (\w+)/.exec(lines[line]);
    if (declaration && declaration[1].length < declarationIndent) { owner = declaration[2]; break; }
  }
  return { module: relative.replace(/\.pyi$/, "").replaceAll("/", ".").replace(/\.__init__$/, ""), owner, name };
}
const server = spawn(process.execPath, [input.server, "--stdio"], { cwd: input.root, stdio: ["pipe", "pipe", "pipe"] });
let buffer = Buffer.alloc(0);
let sequence = 0;
const pending = new Map();
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  send({ id, method, params });
});
server.stderr.resume();
server.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) break;
    const length = Number(buffer.subarray(0, end).toString().match(/Content-Length: (\d+)/i)?.[1]);
    if (!Number.isSafeInteger(length) || length > 8 * 1024 * 1024) { server.kill(); return; }
    if (buffer.length < end + 4 + length) break;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (message.method && message.id !== undefined) {
      send({ id: message.id, result: message.method === "workspace/configuration" ? message.params.items.map((item) =>
        item.section === "python" ? { pythonPath: input.pythonPath } : {}) : null });
    } else if (pending.has(message.id)) {
      const waiter = pending.get(message.id); pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
    }
  }
});
server.on("error", (error) => { for (const waiter of pending.values()) waiter.reject(error); });
server.on("exit", () => { for (const waiter of pending.values()) waiter.reject(new Error("Pyright exited")); });
const timeout = setTimeout(() => { server.kill(); process.exitCode = 1; }, 20000);
try {
  await request("initialize", { processId: process.pid, rootUri: pathToFileURL(input.root).href,
    workspaceFolders: [{ uri: pathToFileURL(input.root).href, name: "frozen-snapshot" }], capabilities: {} });
  send({ method: "initialized", params: {} });
  send({ method: "workspace/didChangeConfiguration", params: { settings: { python: { pythonPath: input.pythonPath } } } });
  for (const file of new Set(input.queries.map((query) => query.file))) {
    send({ method: "textDocument/didOpen", params: { textDocument: { uri: pathToFileURL(file).href, languageId: "python", version: 1, text: readFileSync(file, "utf8") } } });
  }
  const results = [];
  for (const query of input.queries.slice(0, 1000)) {
    const params = { textDocument: { uri: pathToFileURL(query.file).href }, position: query.position };
    const hover = await request("textDocument/hover", params);
    const definitions = await request("textDocument/definition", params);
    results.push({ key: query.key, hover, definitions: (Array.isArray(definitions) ? definitions : definitions ? [definitions] : []).map((item) => ({
      file_path: path.relative(input.root, fileURLToPath(item.uri ?? item.targetUri)).split(path.sep).join("/"), range: item.range ?? item.targetSelectionRange,
      stdlib: stdlibIdentity(fileURLToPath(item.uri ?? item.targetUri), item.range ?? item.targetSelectionRange),
    })) });
  }
  process.stdout.write(JSON.stringify({ results, truncated: input.queries.length > 1000 }));
} catch (error) {
  process.stderr.write(String(error)); process.exitCode = 1;
} finally {
  clearTimeout(timeout); server.kill();
}
