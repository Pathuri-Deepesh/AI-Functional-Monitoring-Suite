import type { ExtractedValue, Extraction } from "./types.js";

/**
 * Extract values from an HTTP response according to the configured extractions.
 *
 * Supported extraction sources:
 *   - `body`   → parse JSON body, evaluate JSONPath (e.g., `$.auth.token`)
 *   - `header` → look up response header by name (case-insensitive)
 *   - `status` → use HTTP status code as the value
 */
export function extractFromResponse(args: {
  extractions: Extraction[];
  responseBody: string;
  responseHeaders: Record<string, string>;
  statusCode: number | null;
}): ExtractedValue[] {
  const { extractions, responseBody, responseHeaders, statusCode } = args;
  const out: ExtractedValue[] = [];

  let parsedBody: unknown = null;
  let bodyParseAttempted = false;

  for (const ex of extractions) {
    if (!ex.saveAs || !ex.saveAs.trim()) continue;

    let value: string | null = null;

    switch (ex.source) {
      case "body": {
        if (!bodyParseAttempted) {
          bodyParseAttempted = true;
          try {
            parsedBody = JSON.parse(responseBody);
          } catch {
            parsedBody = null;
          }
        }
        if (parsedBody !== null) {
          const v = jsonPath(parsedBody, ex.path);
          if (v != null) value = typeof v === "string" ? v : JSON.stringify(v);
        }
        break;
      }
      case "header": {
        const name = ex.path.trim().toLowerCase();
        if (name && responseHeaders[name] != null) {
          value = String(responseHeaders[name]);
        }
        break;
      }
      case "status": {
        if (statusCode != null) value = String(statusCode);
        break;
      }
    }

    if (value != null) {
      out.push({ saveAs: ex.saveAs.trim(), value, fromCache: false });
    }
  }

  return out;
}

/**
 * Minimal JSONPath evaluator.
 * Supports:
 *   - $              → the whole object
 *   - $.foo.bar      → nested property access
 *   - $.items[0]     → numeric array index
 *   - $.items[0].id  → mixed
 *   - $['some key']  → bracket notation with quoted key (single or double quotes)
 *
 * Does NOT support: wildcards, slices, filter expressions, recursive descent.
 * This is intentional — keeps the implementation tiny and predictable.
 */
export function jsonPath(obj: unknown, path: string): unknown {
  if (obj == null || !path) return undefined;
  let p = path.trim();
  if (p === "$") return obj;
  if (p.startsWith("$.")) p = p.slice(2);
  else if (p.startsWith("$")) p = p.slice(1);

  const tokens: Array<string | number> = [];
  let i = 0;
  while (i < p.length) {
    if (p[i] === ".") {
      i++;
      continue;
    }
    if (p[i] === "[") {
      const end = p.indexOf("]", i);
      if (end === -1) return undefined;
      const inside = p.slice(i + 1, end).trim();
      if (
        (inside.startsWith("'") && inside.endsWith("'")) ||
        (inside.startsWith('"') && inside.endsWith('"'))
      ) {
        tokens.push(inside.slice(1, -1));
      } else {
        const n = Number(inside);
        if (!Number.isNaN(n)) tokens.push(n);
        else tokens.push(inside);
      }
      i = end + 1;
    } else {
      const dot = p.indexOf(".", i);
      const br = p.indexOf("[", i);
      const candidates = [dot, br].filter((x) => x !== -1);
      const next = candidates.length === 0 ? p.length : Math.min(...candidates);
      tokens.push(p.slice(i, next));
      i = next;
    }
  }

  let cur: any = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t as keyof typeof cur];
  }
  return cur;
}

/**
 * Apply `{{variableName}}` substitution to a string. Unknown variables are left
 * untouched so the user can spot them in failure responses.
 */
export function substitute(template: string, vars: Record<string, string>): string {
  if (!template || template.indexOf("{{") === -1) return template;
  return template.replace(/\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g, (_match, name) =>
    vars[name] != null ? vars[name] : `{{${name}}}`
  );
}
