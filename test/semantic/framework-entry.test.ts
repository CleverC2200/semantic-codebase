import assert from "node:assert/strict";
import { test } from "node:test";
import { RepositoryIndexer, TypeScriptTreeSitterAdapter, PythonTreeSitterAdapter, TypeScriptSemanticEnricher, PythonPyrightEnricher, sha256Bytes } from "../../src/index.js";

function run(text: string, language: "typescript" | "python") {
  const source_bytes = new TextEncoder().encode(text);
  const source = { repository_id: "framework-test", files: [{ relative_path: language === "python" ? "main.py" : "main.ts", language, source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const adapter = language === "python" ? new PythonTreeSitterAdapter() : new TypeScriptTreeSitterAdapter();
  const state = new RepositoryIndexer({ adapters: [adapter] }).buildFull(source).state;
  const enricher = language === "python" ? new PythonPyrightEnricher() : new TypeScriptSemanticEnricher();
  return enricher.enrich({ state, source });
}
test("Express named handler registration requires imported factory identity", () => {
  const prefix = "import express from 'express'; const app = express(); function handler() { return 1; } ";
  const overlay = run(prefix + "app.get('/items', handler);", "typescript");
  assert.ok(overlay.facts.some((item) => item.kind === "entrypoint" && item.basis.kind === "framework_heuristic"));
  const fake = run("const app = { get(a: string, b: unknown) {} }; function handler() { return 1; } app.get('/items', handler);", "typescript");
  assert.ok(!fake.facts.some((item) => item.kind === "entrypoint" && item.basis.kind === "framework_heuristic"));
});
test("FastAPI decorator is a heuristic route, not a compiler-exact fact", () => {
  const overlay = run("from fastapi import FastAPI\napp = FastAPI()\n@app.get('/items')\ndef items():\n    return 1\n", "python");
  assert.ok(overlay.facts.some((item) => item.kind === "entrypoint" && item.basis.kind === "framework_heuristic"));
  const fake = run("class Fake:\n    pass\napp = Fake()\n@app.get('/items')\ndef items():\n    return 1\n", "python");
  assert.ok(!fake.facts.some((item) => item.kind === "entrypoint" && item.basis.kind === "framework_heuristic"));
});

test("named CLI, event and timer callbacks retain registration Evidence", () => {
  const overlay = run("import { Command } from 'commander'; import { EventEmitter } from 'node:events'; import { setInterval } from 'node:timers'; const program = new Command(); const events = new EventEmitter(); function handler() { return 1; } program.action(handler); events.on('data', handler); setInterval(handler, 1000);", "typescript");
  const kinds = overlay.facts.filter((item) => item.kind === "entrypoint").map((item) => (item.value as { entry_kind: string }).entry_kind);
  for (const kind of ["cli", "event_handler", "scheduled_job"]) assert.ok(kinds.includes(kind), kind);
  assert.ok(!run("const fake = { action(x: unknown) {} }; function handler() {} fake.action(handler);", "typescript").facts.some((item) => item.kind === "entrypoint"));
});

test("Python main guard and imported signal callbacks are entry candidates", () => {
  const overlay = run("import signal\nimport threading\ndef main():\n    return 1\ndef handle(sig, frame):\n    return sig\nsignal.signal(signal.SIGINT, handle)\nthreading.Timer(1, main).start()\nif __name__ == '__main__':\n    main()\n", "python");
  const kinds = overlay.facts.filter((item) => item.kind === "entrypoint").map((item) => (item.value as { entry_kind: string }).entry_kind);
  assert.ok(kinds.includes("cli")); assert.ok(kinds.includes("event_handler"));
  assert.ok(kinds.includes("scheduled_job"));
});
