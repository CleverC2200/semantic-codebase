import { createHash } from "node:crypto";

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeCanonical(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON only accepts finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => {
          if (record[key] === undefined) {
            throw new TypeError(`Canonical JSON does not accept undefined at ${key}`);
          }
          return [key.normalize("NFC"), normalizeCanonical(record[key])];
        }),
    );
  }
  throw new TypeError(`Canonical JSON does not accept ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value));
}

export function canonicalHash(value: unknown): string {
  return sha256Text(canonicalJson(value));
}
