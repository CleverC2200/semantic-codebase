import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalHash } from "../contract/hash.js";

import { answerContextPackage, validateEvidenceAnswer } from "./evidence-answer.js";
import type { ContextPackage, EvidenceAnswer } from "./types.js";
import { ContextPackageError } from "./types.js";
import { readCodexTelemetry } from "./codex-telemetry.js";

const disabledFeatures = ["shell_tool", "unified_exec", "code_mode_host", "apps", "plugins", "multi_agent", "browser_use", "computer_use", "view_image", "image_generation", "memories", "hooks", "workspace_dependencies", "skill_search", "skill_mcp_dependency_install"];

export function answerContextPackageWithCodex(context: ContextPackage, options: {
  run?: (args: string[], input: string) => { status: number | null; error?: Error; stdout?: string };
} = {}): EvidenceAnswer {
  const draft = answerContextPackage(context);
  const prompt = promptFor(context, draft);
  const started = performance.now();
  const receipt: NonNullable<EvidenceAnswer["provider_invocation"]> = {
    provider: "codex", status: "unavailable", package_hash: context.package_hash,
    request_hash: canonicalHash({ prompt, tool_policy: "text_only_feature_overrides_v1" }), response_hash: null, started_at: new Date().toISOString(), duration_ms: 0,
    exit_code: null, input_bytes: Buffer.byteLength(prompt), output_bytes: 0, timeout_ms: 28000,
    model: "codex-default", tool_policy: "text_only_feature_overrides_v1", validation: "not_run", error_code: null,
  };
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "semantic-codebase-codex-"));
  const schemaPath = path.join(temporaryRoot, "answer.schema.json");
  const outputPath = path.join(temporaryRoot, "answer.json");
  try {
    writeFileSync(schemaPath, JSON.stringify(rewriteSchema(draft.findings.length)));
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--ignore-user-config",
      ...disabledFeatures.flatMap((feature) => ["--disable", feature]),
      "-c", 'web_search="disabled"',
      "-c", "project_doc_max_bytes=0",
      "-c", 'approval_policy="never"',
      "-c", "features.skip_host_skill_discovery=true",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--cd", temporaryRoot,
      "--output-schema", schemaPath,
      "--output-last-message", outputPath,
      "-",
    ];
    const result = options.run ? options.run(args, prompt) : spawnSync("codex", args, {
      input: prompt, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: receipt.timeout_ms,
    });
    receipt.exit_code = result.status;
    receipt.telemetry = readCodexTelemetry(result.stdout ?? "", { expectedPolicy: receipt.tool_policy });
    if (result.status !== 0) {
      throw new ContextPackageError(
        "CODEX_ANSWER_FAILED",
        "Codex unavailable or timed out; deterministic evidence remains available",
      );
    }
    receipt.status = "invalid_response";
    const raw = readFileSync(outputPath, "utf8");
    receipt.output_bytes = Buffer.byteLength(raw);
    receipt.response_hash = canonicalHash(raw);
    const rewrite = JSON.parse(raw) as {
      summary: string;
      finding_texts: string[];
    };
    if (!rewrite || typeof rewrite.summary !== "string" || !Array.isArray(rewrite.finding_texts) ||
        rewrite.finding_texts.length !== draft.findings.length || rewrite.finding_texts.some((text) => typeof text !== "string") ||
        Object.keys(rewrite).some((key) => !["summary", "finding_texts"].includes(key))) {
      throw new ContextPackageError("CODEX_INVALID_RESPONSE", "Codex response does not match the presentation schema");
    }
    const answer: EvidenceAnswer = {
      ...draft,
      presentation: { basis: "llm_inferred", verified: false, summary: rewrite.summary, finding_texts: rewrite.finding_texts },
    };
    validateEvidenceAnswer(context, answer);
    receipt.status = "succeeded";
    receipt.validation = "passed";
    receipt.duration_ms = Math.round(performance.now() - started);
    if (receipt.telemetry.assessment === "completed_with_warnings") {
      return { ...answer, status: "partial", unknowns: [...answer.unknowns, "codex_expected_policy_warnings"], provider_invocation: receipt };
    }
    if (receipt.telemetry.assessment !== "clean") {
      return { ...answer, status: "partial", unknowns: [...answer.unknowns, "codex_execution_requires_review"], provider_invocation: receipt };
    }
    return { ...answer, provider_invocation: receipt };
  } catch (error) {
    receipt.error_code = error instanceof ContextPackageError ? error.code : "CODEX_INVALID_RESPONSE";
    receipt.validation = receipt.status === "invalid_response" ? "failed" : "not_run";
    receipt.duration_ms = Math.round(performance.now() - started);
    const answer: EvidenceAnswer = { ...draft, status: "partial",
      unknowns: [...draft.unknowns, "answer_provider_unavailable"], provider_invocation: receipt };
    validateEvidenceAnswer(context, answer);
    return answer;
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
