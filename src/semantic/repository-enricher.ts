import { finalizeSemanticOverlay } from "./overlay.js";
import { PythonPyrightEnricher, PYTHON_SEMANTIC_VERSION } from "./python-pyright-enricher.js";
import { TypeScriptSemanticEnricher, TYPESCRIPT_SEMANTIC_VERSION } from "./typescript-enricher.js";
import { version as typescriptVersion } from "typescript";
import { createRequire } from "node:module";
import type { SemanticEnricher, SemanticEnrichmentInput, SemanticOverlay } from "./types.js";

export const SEMANTIC_ENGINE_PROFILE = {
  typescript: TYPESCRIPT_SEMANTIC_VERSION, python: PYTHON_SEMANTIC_VERSION,
  typescript_compiler: typescriptVersion,
  pyright: (createRequire(import.meta.url)("pyright/package.json") as { version: string }).version,
};

export class SemanticRepositoryEnricher implements SemanticEnricher {
  enrich(input: SemanticEnrichmentInput): SemanticOverlay {
    const overlays: SemanticOverlay[] = [];
    if (input.source.files.some((file) => file.language === "typescript")) {
      overlays.push(new TypeScriptSemanticEnricher().enrich(input));
    }
    if (input.source.files.some((file) => file.language === "python")) {
      overlays.push(new PythonPyrightEnricher().enrich(input));
    }
    if (overlays.length === 1) return overlays[0]!;
    return finalizeSemanticOverlay(input.state, input.source, {
      profile: {
        id: "system-recommended-v0",
        version: "1",
        compiler_version: overlays.map((overlay) => `${overlay.profile.id}@${overlay.profile.version}:${overlay.profile.compiler_version}`).join(","),
      },
      facts: overlays.flatMap((overlay) => overlay.facts),
      evidence: overlays.flatMap((overlay) => overlay.evidence),
      diagnostics: overlays.flatMap((overlay) => overlay.diagnostics),
      coverage: {
        status: overlays.every((overlay) => overlay.coverage.status === "complete") ? "complete" : "partial",
        analyzed_files: overlays.reduce((total, overlay) => total + overlay.coverage.analyzed_files, 0),
        skipped_files: input.source.files.length - overlays.reduce((total, overlay) => total + overlay.coverage.analyzed_files, 0),
        reason_codes: overlays.flatMap((overlay) => overlay.coverage.reason_codes),
      },
    });
  }
}
