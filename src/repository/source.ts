import { readFileSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalHash, sha256Bytes } from "../contract/hash.js";
import type { Language } from "../contract/types.js";
import type { RepositorySource } from "../indexing/types.js";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".workspace",
  ".scb",
  ".codegraph",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "references",
]);

export interface DiscoveredRepository {
  root_path: string;
  store_path: string;
  source: RepositorySource;
}

export function discoverRepository(repositoryPath: string, storePath?: string): DiscoveredRepository {
  if (!repositoryPath) throw new RepositorySourceError("INVALID_ARGUMENT", "--repo is required");
  const root_path = realpathSync(repositoryPath);
  const files = walk(root_path, root_path)
    .map(({ absolutePath, relativePath, language }) => {
      const source_bytes = readFileSync(absolutePath);
      return {
        relative_path: relativePath,
        language,
        source_bytes,
        source_digest: sha256Bytes(source_bytes),
      };
    })
    .sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  const repository_id = canonicalHash({ type: "repository", root_path });
  return {
    root_path,
    store_path: storePath ? path.resolve(storePath) : defaultStorePath(root_path),
    source: { repository_id, files },
  };
}

export function defaultStorePath(repositoryRoot: string): string {
  const directory = canonicalHash({ type: "repository_store", root_path: realpathSync(repositoryRoot) }).slice(0, 24);
  return path.join(os.homedir(), ".semantic-codebase", directory, "snapshots.sqlite");
}

function walk(root: string, directory: string): Array<{
  absolutePath: string;
  relativePath: string;
  language: Language;
}> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : walk(root, absolutePath);
    }
    if (!entry.isFile()) return [];
    const language = languageFor(entry.name);
    if (!language) return [];
    return [{
      absolutePath,
      relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
      language,
    }];
  });
}

function languageFor(fileName: string): Language | null {
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(fileName) && !/\.d\.ts$/.test(fileName)) return "typescript";
  return fileName.endsWith(".py") ? "python" : null;
}

export class RepositorySourceError extends Error {
  constructor(readonly code: "INVALID_ARGUMENT" | "REPOSITORY_NOT_FOUND", message: string) {
    super(message);
    this.name = "RepositorySourceError";
  }
}
