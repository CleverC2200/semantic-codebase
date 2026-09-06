import { createHash } from "node:crypto";

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeText(value: string): string {
  // ASCII is already NFC; hashes, field names and most paths need no ICU pass.
  return /[^\x00-\x7f]/.test(value) ? value.normalize("NFC") : value;
}

function normalizeCanonical(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON only accepts finite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Avoid allocating an entry tuple for every property, preserving special keys.
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) {
        throw new TypeError(`Canonical JSON does not accept undefined at ${key}`);
      }
      const name = normalizeText(key);
      const item = normalizeCanonical(record[key]);
      if (name === "__proto__") Object.defineProperty(normalized, name, { value: item, enumerable: true, writable: true, configurable: true });
      else normalized[name] = item;
    }
    return normalized;
  }
  throw new TypeError(`Canonical JSON does not accept ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value));
}

export function canonicalHash(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

// Graph/Overlay records have fixed ASCII field names and large row arrays.
// Stream those arrays without normalizing/copying the entire record at once.
// Other keys retain the general serializer's numeric ordering/NFC collision rules.
export function canonicalRecordHash(record: Record<string, unknown>): string {
  const keys = Object.keys(record).sort();
  if (keys.some((key) => !/^[a-z_]+$/.test(key))) return canonicalHash(record);
  const hash = createHash("sha256");
  hash.update("{");
  let firstField = true;
  for (const key of keys) {
    hash.update(`${firstField ? "" : ","}${canonicalJson(key)}:`);
    firstField = false;
    const value = record[key];
    if (!Array.isArray(value)) { hash.update(canonicalJson(value)); continue; }
    hash.update("[");
    let chunk = "";
    for (let index = 0; index < value.length; index++) {
      chunk += `${index ? "," : ""}${canonicalJson(index in value ? value[index] : null)}`;
      if (chunk.length >= 32768) { hash.update(chunk); chunk = ""; }
    }
    hash.update(`${chunk}]`);
  }
  hash.update("}");
  return hash.digest("hex");
}
