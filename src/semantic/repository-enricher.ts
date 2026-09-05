import { finalizeSemanticOverlay } from "./overlay.js";
import { PythonPyrightEnricher } from "./python-pyright-enricher.js";
import { TypeScriptSemanticEnricher } from "./typescript-enricher.js";
import type { SemanticEnricher, SemanticEnrichmentInput, SemanticOverlay } from "./types.js";

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
        compiler_version: overlays.map((overlay) => `${overlay.profile.id}:${overlay.profile.compiler_version}`).join(","),
      },
      facts: overlays.flatMap((overlay) => overlay.facts),
      evidence: overlays.flatMap((overlay) => overlay.evidence),
      diagnostics: overlays.flatMap((overlay) => overlay.diagnostics),
      coverage: {
        status: overlays.every((overlay) => overlay.coverage.status === "complete") ? "complete" : "partial",
        analyzed_files: input.source.files.length,
        skipped_files: 0,
        reason_codes: overlays.flatMap((overlay) => overlay.coverage.reason_codes),
      },
    });
  }
}
