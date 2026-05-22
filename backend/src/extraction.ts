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

    let value: string | unknown[] | null = null;

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
          if (v != null) {
            // Arrays are kept as JS arrays (for-each iteration source).
            // Objects are JSON-stringified so legacy scalar consumers still work.
            if (Array.isArray(v)) value = v;
            else value = typeof v === "string" ? v : JSON.stringify(v);
          }
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
 *   - $.items[*]     → wildcard: returns every element as an array (Phase 1.18)
 *   - $.items[*].id  → wildcard with continuation: returns an array of each element's `.id`
 *   - $[*]           → applied directly to a top-level array
 *
 * Does NOT support: slices, filter expressions, recursive descent (..).
 */
const WILDCARD = Symbol("jsonPath:wildcard");

export function jsonPath(obj: unknown, path: string): unknown {
  if (obj == null || !path) return undefined;
  let p = path.trim();
  if (p === "$") return obj;
  if (p.startsWith("$.")) p = p.slice(2);
  else if (p.startsWith("$")) p = p.slice(1);

  const tokens: Array<string | number | typeof WILDCARD> = [];
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
      if (inside === "*") {
        tokens.push(WILDCARD);
      } else if (
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

  return walk(obj, tokens, 0);
}

function walk(
  cur: unknown,
  tokens: Array<string | number | typeof WILDCARD>,
  i: number
): unknown {
  for (; i < tokens.length; i++) {
    if (cur == null) return undefined;
    const t = tokens[i];
    if (t === WILDCARD) {
      if (!Array.isArray(cur)) return undefined;
      const rest = tokens.slice(i + 1);
      if (rest.length === 0) return cur;
      const mapped = cur.map((el) => walk(el, rest, 0));
      return mapped;
    }
    cur = (cur as any)[t as keyof typeof cur];
  }
  return cur;
}

/**
 * Apply `{{variableName}}` substitution to a string. Unknown variables are left
 * untouched so the user can spot them in failure responses.
 *
 * Phase 1.18: `vars` may now contain object values (a for-each iteration item
 * bound to its loop-local name). Templates like `{{student.id}}` walk the dotted
 * path against the object. Flat lookup still wins when the exact key exists.
 */
export function substitute(
  template: string,
  vars: Record<string, unknown>
): string {
  if (!template || template.indexOf("{{") === -1) return template;
  return template.replace(/\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g, (_match, name) => {
    const resolved = resolveVar(vars, name);
    return resolved != null ? toScalar(resolved) : `{{${name}}}`;
  });
}

function resolveVar(vars: Record<string, unknown>, name: string): unknown {
  // Flat lookup wins — preserves pre-1.18 behavior for non-dotted names
  // and for scalar vars whose keys happen to contain dots.
  if (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null) {
    return vars[name];
  }
  // Dotted walk: e.g. "student.id" → vars["student"] then .id.
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  let cur: any = vars[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function toScalar(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
