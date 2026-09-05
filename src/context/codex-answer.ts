import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { answerContextPackage, validateEvidenceAnswer } from "./evidence-answer.js";
import type { ContextPackage, EvidenceAnswer } from "./types.js";
import { ContextPackageError } from "./types.js";

export function answerContextPackageWithCodex(context: ContextPackage): EvidenceAnswer {
  const draft = answerContextPackage(context);
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "semantic-codebase-codex-"));
  const schemaPath = path.join(temporaryRoot, "answer.schema.json");
  const outputPath = path.join(temporaryRoot, "answer.json");
  try {
    writeFileSync(schemaPath, JSON.stringify(rewriteSchema(draft.findings.length)));
    const result = spawnSync("codex", [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--cd", temporaryRoot,
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "-",
    ], {
      input: promptFor(context, draft),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new ContextPackageError(
        "CODEX_ANSWER_FAILED",
        result.stderr.trim() || result.error?.message || "Codex did not return an Evidence Answer",
      );
    }
    const rewrite = JSON.parse(readFileSync(outputPath, "utf8")) as {
      summary: string;
      finding_texts: string[];
    };
    const answer: EvidenceAnswer = {
      ...draft,
      summary: rewrite.summary,
      findings: draft.findings.map((finding, index) => ({ ...finding, text: rewrite.finding_texts[index]! })),
    };
    validateEvidenceAnswer(context, answer);
    return answer;
  } catch (error) {
    if (error instanceof ContextPackageError) throw error;
    throw new ContextPackageError("CODEX_ANSWER_FAILED", error instanceof Error ? error.message : String(error));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function promptFor(context: ContextPackage, draft: EvidenceAnswer): string {
  return [
    "你是 Semantic Codebase 的 Evidence Answer 表述器。",
    "只用中文润色 draft_answer 的 summary 和每条 finding.text。不得新增、删除、合并或拆分 finding。",
    "不得新增事实。static_possible 只能表述为可能；runtime_observed 只能表述为本次 Execution 发生过。",
    "返回严格符合给定 JSON Schema 的单个 JSON 对象。",
    JSON.stringify({
      question: context.question,
      target: context.target,
      definition_names: context.definitions.map((item) => item.qualified_name),
      coverage: context.coverage,
      unknowns: context.unknowns,
      draft_answer: draft,
    }),
  ].join("\n\n");
}

function rewriteSchema(findingCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "finding_texts"],
    properties: {
      summary: { type: "string" },
      finding_texts: {
        type: "array",
        minItems: findingCount,
        maxItems: findingCount,
        items: { type: "string" },
      },
    },
  };
}
