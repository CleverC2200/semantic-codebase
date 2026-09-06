/** Read JSON with comments/trailing commas while preserving quoted strings. */
export function parseJsonc(text: string): unknown {
  const tokens = text.replace(/^\uFEFF/, "").match(/"(?:\\[\s\S]|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[^"/]+|[\s\S]/g) ?? [];
  const stripped = tokens.map((token) => token.startsWith("//") || token.startsWith("/*") ? " " : token).join("");
  // A second lexical pass keeps comma-like content inside strings untouched.
  const clean = stripped.replace(/"(?:\\[\s\S]|[^"\\])*"|,(\s*[}\]])/g, (match, tail: string | undefined) => tail ?? match);
  return JSON.parse(clean);
}
