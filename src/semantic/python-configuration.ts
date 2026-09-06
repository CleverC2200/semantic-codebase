import path from "node:path";
import type { RepositorySource } from "../indexing/types.js";
import { parseJsonc } from "../repository/jsonc.js";
import { SemanticEnrichmentError } from "./types.js";

/** Freeze compiler settings; never let config select or execute a host interpreter. */
export function pythonConfiguration(source: RepositorySource): Record<string, unknown> {
  const files = new Map((source.configuration_files ?? []).map((file) => [file.relative_path, file]));
  const load = (name: string, seen = new Set<string>()): Record<string, unknown> => {
    if (seen.has(name)) fail("cyclic extends");
    seen.add(name);
    const file = files.get(name);
    if (!file) fail(`extends is not frozen: ${name}`);
    let value: unknown;
    try { value = parseJsonc(Buffer.from(file.source_bytes).toString("utf8")); } catch { fail(`invalid JSONC: ${name}`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`invalid object: ${name}`);
    const config = value as Record<string, unknown>;
    // Relative settings in inherited configs are relative to that config's directory.
    const relative = (entry: unknown): string => {
      if (typeof entry !== "string" || path.posix.isAbsolute(entry) || entry.includes("\\")) fail(`invalid path: ${name}`);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), entry));
      if (resolved === ".." || resolved.startsWith("../")) fail(`path escapes frozen repository: ${name}`);
      return resolved;
    };
    const result = config.extends === undefined ? {} : load(relative(config.extends), seen);
    for (const [key, entry] of Object.entries(config)) {
      if (key === "extends") continue;
      if (["venv", "venvPath", "pythonPath", "typeshedPath"].includes(key)) fail(`${key} requires a separately frozen dependency environment`);
      if (["include", "exclude", "ignore", "strict", "extraPaths"].includes(key)) {
        if (!Array.isArray(entry)) fail(`invalid ${key}`);
        result[key] = entry.map(relative);
      } else if (key === "stubPath") result[key] = relative(entry);
      else if (key === "executionEnvironments") {
        if (!Array.isArray(entry)) fail("invalid executionEnvironments");
        result[key] = entry.map((environment: unknown) => {
          if (!environment || typeof environment !== "object" || Array.isArray(environment)) fail("invalid execution environment");
          const converted: Record<string, unknown> = {};
          for (const [setting, item] of Object.entries(environment)) {
            if (setting === "root") converted[setting] = relative(item);
            else if (setting === "extraPaths" && Array.isArray(item)) converted[setting] = item.map(relative);
            else if (["pythonVersion", "pythonPlatform"].includes(setting) || setting.startsWith("report")) converted[setting] = item;
            else fail(`unsupported execution environment setting: ${setting}`);
          }
          return converted;
        });
      } else if (["pythonVersion", "pythonPlatform", "typeCheckingMode", "defineConstant", "useLibraryCodeForTypes", "verboseOutput", "analyzeUnannotatedFunctions", "enableExperimentalFeatures"].includes(key) || key.startsWith("report")) result[key] = entry;
      else fail(`unsupported setting: ${key}`);
    }
    return result;
  };
  return {
    include: ["**/*.py"], pythonVersion: "3.12", typeCheckingMode: "basic", useLibraryCodeForTypes: true,
    ...(files.has("pyrightconfig.json") ? load("pyrightconfig.json") : {}),
  };
}

function fail(message: string): never {
  throw new SemanticEnrichmentError("INVALID_PROJECT_CONFIGURATION", `Python frozen configuration: ${message}`);
}
