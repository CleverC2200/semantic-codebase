import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RepositoryIndexer, TypeScriptTreeSitterAdapter, PythonTreeSitterAdapter,
  TypeScriptSemanticEnricher, PythonPyrightEnricher, sha256Bytes,
  type RepositorySource,
} from "../../src/index.js";

for (const language of ["typescript", "python"] as const) {
  test(`${language}: arbitrary execute and query methods are not database evidence`, () => {
    const source_bytes = new TextEncoder().encode(language === "typescript"
      ? "export function run(env: any, engine: any) { env.execute('python'); return engine.query('syntax'); }"
      : "def run(env, engine):\n    env.execute('python')\n    return engine.query('syntax')\n");
    const source: RepositorySource = { repository_id: "effect-negative", files: [{
      relative_path: language === "typescript" ? "main.ts" : "main.py", language,
      source_bytes, source_digest: sha256Bytes(source_bytes),
    }] };
    const adapter = language === "typescript" ? new TypeScriptTreeSitterAdapter() : new PythonTreeSitterAdapter();
    const state = new RepositoryIndexer({ adapters: [adapter] }).buildFull(source).state;
    const enricher = language === "typescript" ? new TypeScriptSemanticEnricher() : new PythonPyrightEnricher();
    const overlay = enricher.enrich({ state, source });
    assert.ok(overlay.facts.some((fact) => fact.kind === "call_target"));
    assert.equal(overlay.facts.filter((fact) => fact.kind === "effect" &&
      (fact.value as { effect_kind?: string }).effect_kind === "database").length, 0);
    assert.equal(overlay.coverage.status, "partial");
  });
}

test("TypeScript models standard Array mutation but not custom or unknown push", () => {
  const source_bytes = new TextEncoder().encode(`
export function append(ctx: { issues: string[] }, fake: { push(value: string): void }, opaque: any) {
  ctx.issues.push('issue');
  fake.push('not-array');
  opaque.push('unknown');
  return ctx.issues.map(x => x);
}`);
  const source: RepositorySource = { repository_id: "array-effects", files: [{ relative_path: "main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const mutations = overlay.facts.filter((fact) => fact.kind === "effect" && fact.basis.rule_id === "typescript_standard_array_mutation_v1");
  assert.equal(mutations.length, 1);
  assert.equal((mutations[0]!.value as { operation: string }).operation, "ctx.issues.push");
  assert.equal(mutations[0]!.basis.kind, "static_possible");
});

test("TypeScript effects exclude local construction and read-only filesystem calls", () => {
  const source_bytes = Buffer.from(`import { openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
export function work(input: { items: string[] }, store: { value?: number }) {
  let local = 0; local = 1;
  const values: string[] = []; values.push('local');
  const copied = input.items.slice(); copied.reverse();
  const result: Record<string, string> = {}; result['x'] = 'local';
  input.items.push('external'); store.value = 1;
  openSync('input', 0); readFileSync('input');
  writeFileSync('output', 'x'); rmSync('output');
  return result;
}`);
  const source: RepositorySource = { repository_id: "observable-effects", files: [{ relative_path: "main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const effects = overlay.facts.filter((fact) => fact.kind === "effect");
  const stateOperations = effects.filter((fact) => (fact.value as { effect_kind: string }).effect_kind === "state")
    .map((fact) => (fact.value as { operation: string }).operation).sort();
  const fileOperations = effects.filter((fact) => (fact.value as { effect_kind: string }).effect_kind === "file")
    .map((fact) => (fact.value as { operation: string }).operation).sort();
  assert.deepEqual(stateOperations, ["input.items.push", "store.value"]);
  assert.deepEqual(fileOperations, ["rmSync", "writeFileSync"]);
});

test("Python effects exclude local collection construction", () => {
  const source_bytes = Buffer.from(`def work(items: list[str], store):
    values: list[str] = []
    values.append('local')
    result = {}
    result['x'] = 'local'
    items.append('external')
    store.value = 1
    return result
`);
  const source: RepositorySource = { repository_id: "python-observable-effects", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source });
  const operations = overlay.facts.filter((fact) => fact.kind === "effect" && (fact.value as { effect_kind: string }).effect_kind === "state")
    .map((fact) => (fact.value as { operation: string }).operation).sort();
  assert.deepEqual(operations, ["items.append", "store.value"]);
});

test("Python effects treat function-local call results as local while preserving command output", () => {
  const source_bytes = Buffer.from(`class Command:
    def info(self, message): pass
    def line_error(self, message): pass
    def run(self):
        result = create_result()
        result['x'] = 1
        result['items'] = []
        result['items'].append(2)
        self.info('ok')
        self.line_error('bad')
        return result
`);
  const source: RepositorySource = { repository_id: "python-local-results", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source });
  const operations = (kind: string) => overlay.facts.filter((fact) => fact.kind === "effect" && (fact.value as { effect_kind: string }).effect_kind === kind)
    .map((fact) => (fact.value as { operation: string }).operation).sort();
  assert.deepEqual(operations("state"), []);
  assert.deepEqual(operations("event"), ["self.info", "self.line_error"]);
});

for (const language of ["typescript", "python"] as const) test(`${language}: rebinding a fresh local to caller state keeps the later mutation observable`, () => {
  const source_bytes = Buffer.from(language === "typescript" ? `export function work(input: { items: string[] }) {
    let values: string[] = [];
    values = input.items;
    values.push('external');
  }` : `def work(items: list[str]):
    values: list[str] = []
    values = items
    values.append('external')
`);
  const source: RepositorySource = { repository_id: `rebound-effects-${language}`, files: [{
    relative_path: language === "typescript" ? "main.ts" : "main.py", language,
    source_bytes, source_digest: sha256Bytes(source_bytes),
  }] };
  const state = new RepositoryIndexer({ adapters: [language === "typescript" ? new TypeScriptTreeSitterAdapter() : new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = (language === "typescript" ? new TypeScriptSemanticEnricher() : new PythonPyrightEnricher()).enrich({ state, source });
  const operations = overlay.facts.filter((fact) => fact.kind === "effect" && (fact.value as { effect_kind: string }).effect_kind === "state")
    .map((fact) => (fact.value as { operation: string }).operation);
  assert.ok(operations.some((operation) => operation.startsWith("values.")), operations.join(", "));
});

test("TypeScript Map and Set mutations require standard library declarations", () => {
  const source_bytes = Buffer.from("export function run(map: Map<string, number>, set: Set<number>, fake: { set(x: number): void }) { map.set('x', 1); set.add(1); fake.set(1); map.get('x'); }");
  const source: RepositorySource = { repository_id: "map-set", files: [{ relative_path: "main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const effects = overlay.facts.filter((fact) => fact.basis.rule_id === "typescript_standard_collection_mutation_v1");
  assert.deepEqual(effects.map((fact) => (fact.value as { operation: string }).operation).sort(), ["map.set", "set.add"]);
});

test("Python builtin collection and subprocess aliases use typeshed identity, not method spelling", () => {
  const source_bytes = Buffer.from(`from subprocess import run as launch
class Fake:
    def append(self, x): pass
def work(items: list[int], values: dict[str, int], fake: Fake):
    items.append(1)
    values.update({'x': 1})
    fake.append(1)
    launch(['never-executed'])
`);
  const source: RepositorySource = { repository_id: "python-library", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source });
  const effects = overlay.facts.filter((fact) => fact.basis.rule_id === "python_typeshed_library_effect_v1");
  assert.deepEqual(effects.map((fact) => (fact.value as { operation: string }).operation).sort(), ["items.append", "launch", "values.update"]);
  assert.equal((effects.find((fact) => (fact.value as { operation: string }).operation === "launch")!.value as { effect_kind: string }).effect_kind, "process");
});

test("Node builtin imports support aliases while local lookalikes are not effects", () => {
  const source_bytes = Buffer.from(`import { writeFileSync as save } from 'node:fs';
import { spawn as launch } from 'node:child_process';
import * as https from 'node:https';
function fetch(x: string) { return x; }
export function work() { save('never', 'executed'); launch('never'); https.get('https://example.invalid'); fetch('local'); }
`);
  const source: RepositorySource = { repository_id: "node-effects", files: [{ relative_path: "main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  assert.deepEqual(overlay.facts.filter((fact) => fact.basis.rule_id === "preview_library_effect_model")
    .map((fact) => fact.value as { operation: string }).map((value) => value.operation).sort(), ["https.get", "launch", "save"]);
});

test("Node process stdout and stderr writes are events while a shadowed process is not", () => {
  const source_bytes = Buffer.from(`export function report() {
  process.stdout.write('ok');
  process.stderr.write('bad');
}
export function local(process: { stderr: { write(message: string): void } }) {
  process.stderr.write('local');
}`);
  const source: RepositorySource = { repository_id: "node-stream-effects", files: [{ relative_path: "main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const operations = overlay.facts.filter((fact) => fact.kind === "effect" && (fact.value as { effect_kind: string }).effect_kind === "event")
    .map((fact) => (fact.value as { operation: string }).operation).sort();
  assert.deepEqual(operations, ["process.stderr.write", "process.stdout.write"]);
});

test("Node SQLite writes and transaction commands are database effects while reads are not", () => {
  const source_bytes = Buffer.from(`import type { DatabaseSync } from 'node:sqlite';
export function decide(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO decisions VALUES (?)').run('x');
  db.prepare('SELECT value FROM decisions').get();
  db.exec('COMMIT');
}`);
  const source: RepositorySource = { repository_id: "node-sqlite-effects", files: [{ relative_path: "main.ts", language: "typescript", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new TypeScriptTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new TypeScriptSemanticEnricher().enrich({ state, source });
  const operations = overlay.facts.filter((fact) => fact.kind === "effect" && (fact.value as { effect_kind: string }).effect_kind === "database")
    .map((fact) => (fact.value as { operation: string }).operation).sort();
  assert.deepEqual(operations, ["db.exec('BEGIN IMMEDIATE')", "db.exec('COMMIT')", "db.prepare('INSERT INTO decisions VALUES (?)').run('x')"]);
});

test("Python sqlite and urllib use standard definitions and local open stays unclassified", () => {
  const source_bytes = Buffer.from(`import sqlite3
from urllib.request import urlopen as request
def open(x): return x
def work(conn: sqlite3.Connection):
    conn.execute('select 1')
    request('https://example.invalid')
    open('local')
`);
  const source: RepositorySource = { repository_id: "python-io", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source });
  const effects = overlay.facts.filter((fact) => fact.kind === "effect" && ["database", "network", "file"].includes((fact.value as { effect_kind: string }).effect_kind));
  assert.deepEqual(effects.map((fact) => (fact.value as { operation: string }).operation).sort(), ["conn.execute", "request"]);
});

test("Python pathlib writes and deletes are file effects while reads are not", () => {
  const source_bytes = Buffer.from(`from pathlib import Path
def work(path: Path):
    path.read_text()
    path.write_text('x')
    path.unlink()
`);
  const source: RepositorySource = { repository_id: "python-pathlib", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source });
  const operations = overlay.facts.filter((fact) => fact.kind === "effect" && (fact.value as { effect_kind: string }).effect_kind === "file")
    .map((fact) => (fact.value as { operation: string }).operation).sort();
  assert.deepEqual(operations, ["path.unlink", "path.write_text"]);
});

test("Python virtualenv creation, xattr metadata writes and command output retain explicit effects", () => {
  const source_bytes = Buffer.from(`import virtualenv
import xattr
def build(path, io):
    virtualenv.cli_run(['--python', 'python'])
    xattr.setxattr(str(path), 'backup', b'1')
    io.write_error_line('created')
`);
  const source: RepositorySource = { repository_id: "python-explicit-effects", files: [{ relative_path: "main.py", language: "python", source_bytes, source_digest: sha256Bytes(source_bytes) }] };
  const state = new RepositoryIndexer({ adapters: [new PythonTreeSitterAdapter()] }).buildFull(source).state;
  const overlay = new PythonPyrightEnricher().enrich({ state, source });
  const effects = overlay.facts.filter((fact) => fact.kind === "effect").map((fact) => fact.value as { effect_kind: string; operation?: string });
  assert.ok(effects.some((item) => item.effect_kind === "process" && item.operation === "virtualenv.cli_run"));
  assert.ok(effects.some((item) => item.effect_kind === "file" && item.operation === "xattr.setxattr"));
  assert.ok(effects.some((item) => item.effect_kind === "event" && item.operation === "io.write_error_line"));
});
