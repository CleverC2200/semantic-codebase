import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
  const files = discoverFiles(root_path)
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

function discoverFiles(root: string): ReturnType<typeof walk> {
  try {
    const gitRoot = realpathSync(execFileSync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim());
    if (gitRoot !== root) return walk(root, root);
    return execFileSync(
      "git",
      ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).split("\0").filter(Boolean).flatMap((relativePath) => {
      if (relativePath.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return [];
      const language = languageFor(relativePath);
      if (!language) return [];
      const absolutePath = path.join(root, relativePath);
      try {
        const stat = lstatSync(absolutePath);
        return stat.isFile() && !stat.isSymbolicLink()
          ? [{ absolutePath, relativePath, language }]
          : [];
      } catch {
        return [];
      }
    });
  } catch {
    return walk(root, root);
  }
}

export function defaultStorePath(repositoryRoot: string): string {
  const directory = canonicalHash({ type: "repository_store", root_path: realpathSync(repositoryRoot) }).slice(0, 24);
  return path.join(os.homedir(), ".semantic-codebase", directory, "snapshots.sqlite");
}

export function repositoryManifestSummary(source: RepositorySource): {
  digest: string;
  file_count: number;
  byte_length: number;
} {
  const manifest = source.files.map((file) => ({
    relative_path: file.relative_path,
    language: file.language,
    source_digest: file.source_digest,
    byte_length: file.source_bytes.byteLength,
  }));
  return {
    digest: canonicalHash(manifest),
    file_count: manifest.length,
    byte_length: manifest.reduce((total, file) => total + file.byte_length, 0),
  };
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
