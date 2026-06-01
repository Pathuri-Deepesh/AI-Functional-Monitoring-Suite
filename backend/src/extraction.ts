import type { ComputeTransform, ExtractedValue, Extraction } from "./types.js";

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
 *
 * Phase 1.19: also accepts a `ScopeStack` (array of scopes, innermost last) so
 * nested for-each iterations can shadow outer scope bindings. Bare `Record`
 * inputs are wrapped as `[vars]` — call sites unchanged.
 */
export type Scope = Record<string, unknown>;
export type ScopeStack = Scope[];

export function substitute(
  template: string,
  vars: Scope | ScopeStack
): string {
  if (!template || template.indexOf("{{") === -1) return template;
  const stack: ScopeStack = Array.isArray(vars) ? vars : [vars];
  return template.replace(/\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g, (_match, name) => {
    const resolved = resolveVar(stack, name);
    return resolved != null ? toScalar(resolved) : `{{${name}}}`;
  });
}

/**
 * Resolve `name` against the scope stack: walk innermost → outermost, and within
 * each scope try a flat lookup first, then dotted-path walk. The first scope that
 * binds the root identifier wins (so an inner loop's `student` correctly shadows
 * any outer-scope `student`).
 */
export function resolveVar(stack: ScopeStack, name: string): unknown {
  const parts = name.split(".");
  const root = parts[0];
  for (let s = stack.length - 1; s >= 0; s--) {
    const vars = stack[s];
    // Flat lookup wins inside this scope (preserves pre-1.18 behavior for keys
    // that happen to contain dots).
    if (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null) {
      return vars[name];
    }
    if (!Object.prototype.hasOwnProperty.call(vars, root)) continue;
    let cur: any = vars[root];
    for (let i = 1; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    if (cur != null) return cur;
  }
  return undefined;
}

function toScalar(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// =============================================================
// Phase 1.21 — Compute step transforms
// =============================================================

/**
 * Apply a single transform to a value, with access to the current scope stack
 * so `concat` and `mapAddField`'s template interpolation can reach prior vars.
 *
 * Throws on programmer error (unknown transform kind, mapAddField on non-array).
 * Returns the literal string `""` for null/undefined inputs so downstream code
 * never has to special-case missing fields.
 */
export function applyComputeTransform(
  value: unknown,
  transform: ComputeTransform,
  stack: ScopeStack
): unknown {
  switch (transform.kind) {
    case "splitTake": {
      const s = value == null ? "" : String(value);
      const parts = s.split(transform.separator);
      const idx = transform.index >= 0 ? transform.index : parts.length + transform.index;
      return parts[idx] ?? "";
    }
    case "slice": {
      const s = value == null ? "" : String(value);
      return s.slice(transform.start, transform.end);
    }
    case "lowercase":
      return value == null ? "" : String(value).toLowerCase();
    case "uppercase":
      return value == null ? "" : String(value).toUpperCase();
    case "trim":
      return value == null ? "" : String(value).trim();
    case "replace": {
      const s = value == null ? "" : String(value);
      // Literal replace (not regex). `replaceAll` honors a string `find` as a literal.
      return s.split(transform.find).join(transform.replace);
    }
    case "concat": {
      // `source` is ignored; template is self-contained and walks the scope stack.
      return substitute(transform.template, stack);
    }
    case "mapAddField": {
      if (!Array.isArray(value)) {
        throw new Error(
          `Compute mapAddField expected an array source, got ${typeof value}`
        );
      }
      return value.map((el) => {
        const sourceVal =
          el && typeof el === "object" && transform.sourceField in (el as Record<string, unknown>)
            ? (el as Record<string, unknown>)[transform.sourceField]
            : "";
        // Push the element onto the scope stack so inner transforms (notably
        // concatArrays) can resolve per-element fields by name — e.g. an element
        // `{countries:[...], regions:[...]}` makes `concatArrays(["countries","regions"])`
        // see those arrays as if they were top-level vars.
        const innerStack: ScopeStack =
          el && typeof el === "object" ? [...stack, el as Scope] : stack;
        const newVal = applyComputeTransform(sourceVal, transform.inner, innerStack);
        return { ...(el as Record<string, unknown>), [transform.fieldName]: newVal };
      });
    }
    case "concatArrays": {
      // `source` (value) is ignored; we resolve each named variable from the scope
      // stack ourselves so the user can combine N arrays in one row.
      // Missing variables are skipped (matches `concat`'s lenient template behavior).
      // Type mismatches throw — that's a real configuration error worth surfacing.
      const out: unknown[] = [];
      for (const rawName of transform.sources) {
        const name = (rawName ?? "").trim();
        if (!name) continue;
        const v = resolveVar(stack, name);
        if (v == null) continue;
        if (!Array.isArray(v)) {
          throw new Error(
            `Compute concatArrays expected '${name}' to be an array, got ${typeof v}`
          );
        }
        out.push(...v);
      }
      return out;
    }
    default: {
      const _exhaustive: never = transform;
      throw new Error(`Unknown compute transform: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// =============================================================
// Phase 1.21 — Live URL preview helpers
// =============================================================

export type PreviewSegment = {
  text: string;
  kind: "literal" | "resolved" | "unresolved";
};

export type PreviewRow = {
  url: string;
  segments: PreviewSegment[];
};

export type PreviewResult = {
  rows: PreviewRow[];
  /** Estimated total calls per run (e.g. 44 campaigns × ~1.5 countries each ≈ 69). */
  estimatedTotal: number;
  /** Number of rows sampled vs. estimatedTotal (rows.length when smaller, capped otherwise). */
  sampledCount: number;
  /** True if any segment in any row could not be resolved (typo / missing var). */
  hasUnresolved: boolean;
};

/**
 * Expand a URL template against a sample variable snapshot, materializing up to
 * `maxSamples` representative rows. When the template references a for-each
 * `itemVarName`, the helper looks up the corresponding array via `iterables`
 * (`itemVarName → arrayPath`) and walks a deterministic prefix of it so the
 * preview is stable across opens.
 *
 * Each segment is tagged so the UI can color-code:
 *   - `literal`     → text outside any `{{...}}`
 *   - `resolved`    → `{{var}}` that produced a non-empty value
 *   - `unresolved`  → `{{var}}` that walked off the sample data
 */
export function expandTemplateForPreview(args: {
  template: string;
  sampleVars: Scope;
  /** Map of for-each `itemVarName` → dotted path that resolves to its array in `sampleVars`. */
  iterables: Record<string, string>;
  maxSamples?: number;
}): PreviewResult {
  const { template, sampleVars, iterables, maxSamples = 20 } = args;

  // Identify which iterable item-names actually appear in the template (as `{{itemName...}}`).
  const itemNames = Object.keys(iterables);
  const usedItems = itemNames.filter((name) =>
    new RegExp(`\\{\\{\\s*${escapeRegex(name)}(\\.|\\s|\\}\\})`).test(template)
  );

  // Materialize each used iterable's source array (or [undefined] if not in sample yet).
  const sourceArrays: Array<{ name: string; items: unknown[] }> = usedItems.map((name) => {
    const path = iterables[name];
    const arr = resolveVar([sampleVars], path);
    return {
      name,
      items: Array.isArray(arr) ? arr : [undefined],
    };
  });

  // Cartesian-product the iterables, then walk the first `maxSamples` combos.
  const totalCombos = sourceArrays.reduce(
    (acc, src) => acc * Math.max(1, src.items.length),
    1
  );
  const cap = Math.min(totalCombos, maxSamples);

  const rows: PreviewRow[] = [];
  let hasUnresolved = false;
  for (let i = 0; i < cap; i++) {
    const iterScope: Scope = {};
    let remainder = i;
    for (const src of sourceArrays) {
      const len = Math.max(1, src.items.length);
      const idx = remainder % len;
      remainder = Math.floor(remainder / len);
      iterScope[src.name] = src.items[idx];
    }
    const row = buildPreviewRow(template, [sampleVars, iterScope]);
    if (row.segments.some((s) => s.kind === "unresolved")) hasUnresolved = true;
    rows.push(row);
  }

  // If template has no `{{var}}` at all, surface a single literal row so the
  // caller can choose to suppress the panel entirely.
  if (rows.length === 0 && template) {
    rows.push({ url: template, segments: [{ text: template, kind: "literal" }] });
  }

  return {
    rows,
    estimatedTotal: totalCombos,
    sampledCount: rows.length,
    hasUnresolved,
  };
}

function buildPreviewRow(template: string, stack: ScopeStack): PreviewRow {
  const segments: PreviewSegment[] = [];
  const re = /\{\{\s*([a-zA-Z_][\w.-]*)\s*\}\}/g;
  let cursor = 0;
  let urlOut = "";
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (match.index > cursor) {
      const literal = template.slice(cursor, match.index);
      segments.push({ text: literal, kind: "literal" });
      urlOut += literal;
    }
    const name = match[1];
    const resolved = resolveVar(stack, name);
    if (resolved == null || resolved === "") {
      segments.push({ text: `{{${name}}}`, kind: "unresolved" });
      urlOut += `{{${name}}}`;
    } else {
      const text = toScalar(resolved);
      segments.push({ text, kind: "resolved" });
      urlOut += text;
    }
    cursor = re.lastIndex;
  }
  if (cursor < template.length) {
    const tail = template.slice(cursor);
    segments.push({ text: tail, kind: "literal" });
    urlOut += tail;
  }
  return { url: urlOut, segments };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
