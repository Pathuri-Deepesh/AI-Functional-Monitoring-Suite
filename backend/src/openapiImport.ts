/**
 * Phase 1.26 — Import URLs (+ optionally Flows / Prereqs) from a Swagger / OpenAPI 3.x spec.
 *
 * Inverse of openapiExport.ts:
 *  - Every operation in `paths:` → one Monitored URL.
 *  - When the spec carries `x-mon-project-id` (i.e. it was exported by THIS suite),
 *    we ALSO reconstruct flows from `x-mon-flows` and prereqs from operations flagged
 *    `x-mon-prereq: true`. Third-party specs (Petstore, Stripe, …) skip those sections.
 *
 * The flow is split into three pure-ish phases:
 *   1. fetchAndParseSpec(specUrl)        → parsed doc (or clear error)
 *   2. diffSpecAgainstProject(parsed, …) → preview (per-section new/unchanged/drifted/removed)
 *   3. applyImport(projectId, parsed, …) → transactional writes
 *
 * No AI. No body-sample synthesis (left empty for the user). Hermetic ($ref: external is off).
 */
import { createHash, randomUUID } from "node:crypto";
import SwaggerParser from "@apidevtools/swagger-parser";
import yaml from "js-yaml";
import {
  addApiKey,
  addFlowStep,
  addPrereqStep,
  addUrl,
  createFlow,
  deleteFlow,
  deletePrereqStep,
  getProject,
  getUrlsByImportSpec,
  listFlowsByProject,
  getFlowWithSteps,
  listPrereqSteps,
  listUrlsByProject,
  removeUrl,
} from "./store.js";
import { tx } from "./db.js";
import type {
  ApiKey,
  Assertion,
  BodyType,
  ComputeConfig,
  Extraction,
  FlowWithSteps,
  ForEachConfig,
  HttpMethod,
  KeyValue,
  MonitoredUrl,
  PrereqStep,
  Project,
} from "./types.js";

// ===== Minimal OpenAPI 3.x shape (only what we read) =====

interface OpenAPIDocument {
  openapi?: string;
  swagger?: string; // 2.0 detection only
  info?: { title?: string; description?: string; version?: string };
  servers?: Array<{ url: string; variables?: Record<string, { default?: string }> }>;
  paths?: Record<string, PathItem>;
  components?: { securitySchemes?: Record<string, SecurityScheme> };
  security?: Array<Record<string, string[]>>;
  ["x-mon-project-id"]?: string;
  ["x-mon-flows"]?: XMonFlow[];
}

interface PathItem {
  parameters?: Parameter[];
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
  head?: Operation;
  options?: Operation;
  servers?: Array<{ url: string }>;
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, { description?: string }>;
  security?: Array<Record<string, string[]>>;
  servers?: Array<{ url: string }>;
  deprecated?: boolean;
  // x-mon-* extensions present on round-trip imports
  ["x-mon-url-id"]?: string;
  ["x-mon-step-id"]?: string;
  ["x-mon-prereq-id"]?: string;
  ["x-mon-interval-min"]?: number;
  ["x-mon-assertions"]?: Assertion[];
  ["x-mon-extractions"]?: Extraction[];
  ["x-mon-step"]?: XMonStepMetadata;
  ["x-mon-prereq"]?: boolean;
  ["x-mon-prereq-order"]?: number;
  ["x-mon-custom-headers"]?: KeyValue[];
  ["x-mon-query-params"]?: KeyValue[];
  ["x-mon-wait-before-ms"]?: number;
  ["x-mon-max-retries"]?: number;
  ["x-mon-retry-backoff-ms"]?: number;
  ["x-mon-body-type"]?: string;
  ["x-mon-body"]?: string;
  ["x-mon-body-content-type"]?: string;
}

interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
}

interface RequestBody {
  required?: boolean;
  content?: Record<string, unknown>;
}

type SecurityScheme =
  | { type: "http"; scheme: string }
  | { type: "apiKey"; in: "header" | "query" | "cookie"; name: string }
  | { type: "oauth2"; [k: string]: unknown }
  | { type: "openIdConnect"; [k: string]: unknown };

interface XMonFlow {
  id: string;
  name: string;
  description?: string;
  intervalMinutes?: number;
  stopOnFailure?: boolean;
  enabled?: boolean;
  steps: XMonFlowStepRef[];
}

interface XMonFlowStepRef {
  position: number;
  level: number;
  stepType: "http" | "compute" | "loop";
  description?: string;
  method?: string;
  path?: string;
  server?: string;
  stepId: string;
  forEach?: ForEachConfig;
  compute?: ComputeConfig;
}

interface XMonStepMetadata {
  flowId: string;
  flowName: string;
  position: number;
  level: number;
  stepType: "http" | "compute" | "loop";
  forEach?: ForEachConfig;
  extractions?: Extraction[];
  assertions?: Assertion[];
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
type MethodKey = (typeof HTTP_METHODS)[number];

// ===== Public types =====

export interface ParsedSpec {
  rawDoc: OpenAPIDocument;
  specId: string;            // SHA-1 of title + "::" + version (or URL fallback)
  specTitle: string;
  specVersion: string;
  specUrl: string;
  isRoundTrip: boolean;      // true if x-mon-project-id present
}

export type DiffStatus = "new" | "unchanged" | "drifted" | "removed";

export interface EndpointPreview {
  identity: string;          // operationId or `${METHOD} ${pathTemplate}`
  method: HttpMethod;
  pathTemplate: string;      // internal `{{var}}` syntax
  fullUrl: string;           // assembled with server + path
  summary: string;
  deprecated: boolean;
  authSchemeId: string | null;
  status: DiffStatus;
  existingUrlId?: string;
  driftReason?: string;
}

export interface AuthSchemePreview {
  schemeId: string;
  type: "http-bearer" | "apiKey-header" | "unsupported";
  unsupportedKind?: string;   // e.g. "oauth2" — when type === "unsupported"
  headerName?: string;
  matchedApiKeyId: string | null;
  matchReason: "name" | "header-tuple" | "none";
}

export interface FlowPreview {
  xMonFlowId: string;        // id from x-mon-flows[].id
  name: string;
  stepCount: number;
  status: DiffStatus;
  existingFlowId?: string;
}

export interface PrereqPreview {
  xMonPrereqId: string;
  position: number;
  method: HttpMethod;
  pathTemplate: string;
  status: DiffStatus;
  existingPrereqId?: string;
}

export interface ImportDiff {
  endpoints: EndpointPreview[];
  authSchemes: AuthSchemePreview[];
  flows: FlowPreview[];
  prereqs: PrereqPreview[];
  removed: {
    urls: Array<{ id: string; url: string; method: HttpMethod; importSource: string | null }>;
    flows: Array<{ id: string; name: string }>;
    prereqs: Array<{ id: string; position: number; url: string }>;
  };
  warnings: string[];
}

export interface ApiKeyCreate {
  schemeId: string;
  name: string;
  headerName: string;
  headerPrefix: string;
  value: string;
}

export interface ImportSelections {
  endpointIdentities: string[];      // identities to create/overwrite
  flowIds: string[];                 // x-mon-flow IDs (from x-mon-flows[].id)
  prereqIds: string[];               // x-mon-prereq IDs
  deleteUrlIds: string[];            // existing URLs flagged "Removed from spec" to delete
  deleteFlowIds: string[];
  deletePrereqIds: string[];
  apiKeyCreates: ApiKeyCreate[];
  baseUrlOverride?: string;          // when spec has no usable servers[]
  includeDeprecated?: boolean;
}

export interface ImportResult {
  createdUrls: number;
  createdFlows: number;
  createdPrereqs: number;
  createdApiKeys: number;
  updatedUrls: number;
  deletedUrls: number;
  deletedFlows: number;
  deletedPrereqs: number;
  errors: string[];
}

// ===== Fetch + parse =====

const MAX_SPEC_BYTES = 10 * 1024 * 1024; // 10MB
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchAndParseSpec(specUrl: string): Promise<ParsedSpec> {
  const trimmed = (specUrl || "").trim();
  if (!trimmed) throw new Error("Spec URL is required");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error("Invalid spec URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http(s) spec URLs are supported");
  }

  // Fetch with a hard ceiling so a 1GB YAML can't OOM the backend.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let rawText: string;
  try {
    const res = await fetch(trimmed, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Spec fetch failed: HTTP ${res.status}`);
    const cl = Number(res.headers.get("content-length") || "0");
    if (cl && cl > MAX_SPEC_BYTES) throw new Error("Spec exceeds 10MB limit");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_SPEC_BYTES) throw new Error("Spec exceeds 10MB limit");
    rawText = new TextDecoder("utf-8").decode(buf);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Spec fetch timed out (>30s)");
    }
    if (err instanceof Error) throw err;
    throw new Error("Spec fetch failed");
  } finally {
    clearTimeout(timer);
  }

  // Parse YAML or JSON (yaml.load handles JSON too — it's a superset).
  let doc: any;
  try {
    doc = yaml.load(rawText);
  } catch (err) {
    throw new Error(`Spec is not valid YAML/JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!doc || typeof doc !== "object") {
    throw new Error("URL did not return a valid OpenAPI 3.x document");
  }

  // Swagger 2.0 detection — bail with a clear message.
  if (doc.swagger && String(doc.swagger).startsWith("2.")) {
    throw new Error(
      "Spec is Swagger 2.0 — convert to OpenAPI 3.x at editor.swagger.io and retry",
    );
  }
  if (!doc.openapi || !String(doc.openapi).startsWith("3.")) {
    throw new Error("URL did not return a valid OpenAPI 3.x document");
  }

  // Bundle (resolves internal $refs without inlining — avoids OOM on circular schemas).
  // resolve.external = false to keep imports hermetic; no surprise network calls.
  let bundled: any;
  try {
    bundled = await SwaggerParser.bundle(doc, { resolve: { external: false } } as any);
  } catch (err) {
    throw new Error(
      `Spec parsing failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const title = String(bundled?.info?.title ?? "Imported spec").trim();
  const version = String(bundled?.info?.version ?? "1.0.0").trim();
  const specId = createHash("sha1")
    .update(`${title}::${version}`)
    .digest("hex")
    .slice(0, 16);

  return {
    rawDoc: bundled as OpenAPIDocument,
    specId,
    specTitle: title,
    specVersion: version,
    specUrl: trimmed,
    isRoundTrip: typeof bundled["x-mon-project-id"] === "string",
  };
}

// ===== Helpers =====

/** Convert OpenAPI `{var}` path templating to our internal `{{var}}` syntax. */
export function pathTemplateToInternalSyntax(path: string): string {
  return path.replace(/\{([^/}]+)\}/g, "{{$1}}");
}

/** Stable identity for an operation across re-imports. */
export function operationIdentity(method: string, pathTemplate: string, operationId?: string): string {
  if (operationId && operationId.trim()) return operationId.trim();
  return `${method.toUpperCase()} ${pathTemplate}`;
}

/** Lowercase HTTP method → enum, mapping disallowed methods (DELETE/HEAD/OPTIONS) safely. */
function methodToHttpMethod(m: string): HttpMethod | null {
  const up = m.toUpperCase();
  if (up === "GET" || up === "POST" || up === "PUT" || up === "PATCH") return up;
  return null; // DELETE/HEAD/OPTIONS — we skip these on import.
}

/** Substitute {var}-style server URL variables with their defaults (best-effort). */
function resolveServerUrl(raw: string, variables?: Record<string, { default?: string }>): string {
  if (!variables) return raw;
  return raw.replace(/\{([^/}]+)\}/g, (m, name) => {
    const v = variables[name];
    return v && v.default ? String(v.default) : m;
  });
}

/**
 * Pick the first usable server URL. Override (when provided) wins — the user
 * supplies it specifically because the spec's `servers:` is missing, relative,
 * or wrong. Otherwise prefer op > path > top-level (closest scope wins).
 *
 * If the resolved server URL is relative (e.g. Petstore's `/api/v3`), it's
 * resolved against `specUrl` so callers don't have to type a Base URL override
 * for every spec that uses relative server paths.
 */
function pickBaseUrl(
  doc: OpenAPIDocument,
  pathItem: PathItem,
  op: Operation,
  override?: string,
  specUrl?: string,
): string {
  if (override && override.trim()) return override.trim();
  let raw = "";
  const fromOp = op.servers?.[0];
  if (fromOp?.url) raw = resolveServerUrl(fromOp.url, (fromOp as any).variables);
  if (!raw) {
    const fromPath = pathItem.servers?.[0];
    if (fromPath?.url) raw = resolveServerUrl(fromPath.url, (fromPath as any).variables);
  }
  if (!raw) {
    const fromDoc = doc.servers?.[0];
    if (fromDoc?.url) raw = resolveServerUrl(fromDoc.url, fromDoc.variables);
  }
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  // Relative server URL — resolve against the spec URL the user pasted.
  if (specUrl) {
    try {
      return new URL(raw, specUrl).toString().replace(/\/+$/, "");
    } catch {
      // fall through
    }
  }
  return raw; // will be rejected downstream as invalid http(s) — surfaces clearly
}

/** Merge path-level + operation-level parameters; operation wins on name collision. */
function mergeParameters(pathItem: PathItem, op: Operation): Parameter[] {
  const byKey = new Map<string, Parameter>();
  for (const p of pathItem.parameters || []) byKey.set(`${p.in}:${p.name}`, p);
  for (const p of op.parameters || []) byKey.set(`${p.in}:${p.name}`, p);
  return Array.from(byKey.values());
}

/** Resolve `${baseUrl}${pathTemplate}` cleanly, avoiding `//` between them. */
function joinUrl(base: string, path: string): string {
  if (!base) return path; // path-only (will be rejected by addUrl as invalid http(s) — surface at preview)
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/** Pick the lowest-defined 2xx response code → status-equals assertion; fallback `status < 400`. */
function buildDefaultAssertions(op: Operation): Assertion[] {
  if (op["x-mon-assertions"]?.length) return op["x-mon-assertions"];
  const codes = Object.keys(op.responses || {})
    .map((k) => Number(k))
    .filter((n) => n >= 200 && n < 300)
    .sort((a, b) => a - b);
  if (codes.length > 0) {
    return [
      { id: randomUUID(), type: "status-equals", config: { value: codes[0] } },
    ];
  }
  return [
    { id: randomUUID(), type: "status-in-range", config: { min: 200, max: 399 } },
  ];
}

/** Headers parameters → empty-value KeyValue[] (user fills in real values post-import). */
function paramsToHeaders(params: Parameter[]): KeyValue[] {
  return params
    .filter((p) => p.in === "header")
    .map((p) => ({ key: p.name, value: "" }));
}

function paramsToQuery(params: Parameter[]): KeyValue[] {
  return params
    .filter((p) => p.in === "query")
    .map((p) => ({ key: p.name, value: "" }));
}

/** Auth — match by name (case-insensitive) → fallback (headerName, type) tuple. */
function matchApiKey(
  scheme: SecurityScheme | undefined,
  schemeId: string,
  existing: ApiKey[],
): { key: ApiKey | null; reason: "name" | "header-tuple" | "none" } {
  if (!scheme) return { key: null, reason: "none" };
  const byName = existing.find((k) => k.name.toLowerCase() === schemeId.toLowerCase());
  if (byName) return { key: byName, reason: "name" };
  if (scheme.type === "apiKey" && scheme.in === "header") {
    const byHeader = existing.find(
      (k) => k.headerName.toLowerCase() === scheme.name.toLowerCase(),
    );
    if (byHeader) return { key: byHeader, reason: "header-tuple" };
  }
  if (scheme.type === "http" && scheme.scheme.toLowerCase() === "bearer") {
    const byHeader = existing.find(
      (k) =>
        k.headerName.toLowerCase() === "authorization" &&
        (k.headerPrefix || "").trim().toLowerCase().startsWith("bearer"),
    );
    if (byHeader) return { key: byHeader, reason: "header-tuple" };
  }
  return { key: null, reason: "none" };
}

function classifyScheme(scheme: SecurityScheme): AuthSchemePreview["type"] {
  if (scheme.type === "http" && (scheme as any).scheme?.toLowerCase() === "bearer") {
    return "http-bearer";
  }
  if (scheme.type === "apiKey" && (scheme as any).in === "header") {
    return "apiKey-header";
  }
  return "unsupported";
}

/**
 * Pick the auth scheme an operation should use.
 *
 * OpenAPI 3.x: if an operation declares its own `security`, that wins (and
 * `security: []` means explicit anonymous). Otherwise the document-level
 * `security` applies. Each array entry is an OR alternative — we prefer the
 * first SUPPORTED one (skipping oauth2/openIdConnect/basic) so a Stripe-style
 * `[{basicAuth}, {bearerAuth}]` resolves to bearerAuth, not basicAuth.
 */
function resolveAuthSchemeId(
  doc: OpenAPIDocument,
  op: Operation,
): string | null {
  const security = op.security !== undefined ? op.security : doc.security;
  if (!security || security.length === 0) return null;
  const schemes = doc.components?.securitySchemes || {};
  // First pass: a supported scheme.
  for (const req of security) {
    const id = Object.keys(req)[0];
    if (!id) continue;
    const scheme = schemes[id];
    if (scheme && classifyScheme(scheme) !== "unsupported") return id;
  }
  // Fallback: first scheme (even if unsupported — preview will mark it skipped).
  for (const req of security) {
    const id = Object.keys(req)[0];
    if (id) return id;
  }
  return null;
}

/** Walk paths & yield (methKey, pathKey, pathItem, op) tuples. */
function* iterateOperations(
  doc: OpenAPIDocument,
): IterableIterator<{ methKey: MethodKey; pathKey: string; pathItem: PathItem; op: Operation }> {
  const paths = doc.paths || {};
  for (const pathKey of Object.keys(paths)) {
    const pathItem = paths[pathKey];
    if (!pathItem) continue;
    for (const m of HTTP_METHODS) {
      const op = (pathItem as any)[m] as Operation | undefined;
      if (!op) continue;
      yield { methKey: m, pathKey, pathItem, op };
    }
  }
}

// ===== Diff =====

/** True when two URLs differ on method or path template (shallow drift detection). */
function isDrifted(existing: MonitoredUrl, parsedFullUrl: string, method: HttpMethod): {
  drifted: boolean;
  reason?: string;
} {
  if (existing.method !== method) {
    return { drifted: true, reason: `method ${existing.method} → ${method}` };
  }
  if (existing.url !== parsedFullUrl) {
    return { drifted: true, reason: "URL or path template changed" };
  }
  return { drifted: false };
}

export function diffSpecAgainstProject(
  parsed: ParsedSpec,
  project: Project,
  existingUrls: MonitoredUrl[],
  existingFlows: FlowWithSteps[],
  existingPrereqs: PrereqStep[],
  options: { includeDeprecated?: boolean; baseUrlOverride?: string } = {},
): ImportDiff {
  const { rawDoc } = parsed;
  const warnings: string[] = [];
  const authSchemes: AuthSchemePreview[] = [];
  const endpoints: EndpointPreview[] = [];
  const flows: FlowPreview[] = [];
  const prereqs: PrereqPreview[] = [];

  // ---- Auth schemes ----
  const securitySchemes = rawDoc.components?.securitySchemes || {};
  for (const schemeId of Object.keys(securitySchemes)) {
    const scheme = securitySchemes[schemeId];
    const classified = classifyScheme(scheme);
    if (classified === "unsupported") {
      authSchemes.push({
        schemeId,
        type: "unsupported",
        unsupportedKind: scheme.type,
        matchedApiKeyId: null,
        matchReason: "none",
      });
      warnings.push(
        `Auth scheme "${schemeId}" (${scheme.type}) is not supported — skipped.`,
      );
      continue;
    }
    const match = matchApiKey(scheme, schemeId, project.apiKeys);
    const headerName =
      scheme.type === "apiKey" && (scheme as any).in === "header"
        ? (scheme as any).name
        : scheme.type === "http"
        ? "Authorization"
        : undefined;
    authSchemes.push({
      schemeId,
      type: classified,
      headerName,
      matchedApiKeyId: match.key?.id ?? null,
      matchReason: match.reason,
    });
  }

  // Quick lookup of existing URLs by (importSpecId, importSource).
  const existingBySource = new Map<string, MonitoredUrl>();
  for (const u of existingUrls) {
    if (u.importSpecId === parsed.specId && u.importSource) {
      existingBySource.set(u.importSource, u);
    }
  }
  const matchedExistingUrlIds = new Set<string>();

  // ---- Endpoints ----
  for (const { methKey, pathKey, pathItem, op } of iterateOperations(rawDoc)) {
    const httpMethod = methodToHttpMethod(methKey);
    if (!httpMethod) continue; // DELETE/HEAD/OPTIONS — silently skipped
    if (op.deprecated && !options.includeDeprecated) continue;

    const pathTemplate = pathTemplateToInternalSyntax(pathKey);
    const baseUrl = pickBaseUrl(rawDoc, pathItem, op, options.baseUrlOverride, parsed.specUrl);
    const fullUrl = joinUrl(baseUrl, pathTemplate);
    const identity = operationIdentity(httpMethod, pathTemplate, op.operationId);

    const authSchemeId = resolveAuthSchemeId(rawDoc, op);

    const existing = existingBySource.get(identity);
    let status: DiffStatus = "new";
    let driftReason: string | undefined;
    if (existing) {
      matchedExistingUrlIds.add(existing.id);
      const d = isDrifted(existing, fullUrl, httpMethod);
      if (d.drifted) {
        status = "drifted";
        driftReason = d.reason;
      } else {
        status = "unchanged";
      }
    }

    if (!baseUrl) {
      warnings.push(
        `Operation ${identity} has no server URL — provide a Base URL override or the spec must list \`servers:\`.`,
      );
    }

    endpoints.push({
      identity,
      method: httpMethod,
      pathTemplate,
      fullUrl,
      summary: op.summary?.trim() || op.description?.trim() || op.operationId || "",
      deprecated: !!op.deprecated,
      authSchemeId,
      status,
      existingUrlId: existing?.id,
      driftReason,
    });
  }

  // ---- Removed-from-spec URLs (in DB under this spec id, but absent from parsed) ----
  const removedUrls = existingUrls
    .filter((u) => u.importSpecId === parsed.specId && !matchedExistingUrlIds.has(u.id))
    .map((u) => ({
      id: u.id,
      url: u.url,
      method: u.method,
      importSource: u.importSource,
    }));

  // ---- Round-trip-only: Flows + Prereqs ----
  const removedFlows: ImportDiff["removed"]["flows"] = [];
  const removedPrereqs: ImportDiff["removed"]["prereqs"] = [];

  if (parsed.isRoundTrip) {
    const xFlows = rawDoc["x-mon-flows"] || [];
    const matchedFlowIds = new Set<string>();
    for (const xf of xFlows) {
      // Identity: prefer x-mon-flows[].id (verbatim round-trip); fallback name (case-insensitive).
      const existingFlow =
        existingFlows.find((f) => f.id === xf.id) ||
        existingFlows.find((f) => f.name.toLowerCase() === (xf.name || "").toLowerCase());
      if (existingFlow) matchedFlowIds.add(existingFlow.id);
      flows.push({
        xMonFlowId: xf.id,
        name: xf.name,
        stepCount: xf.steps?.length || 0,
        status: existingFlow ? "unchanged" : "new",
        existingFlowId: existingFlow?.id,
      });
    }
    // Flows in DB not in spec — only flag for removal if they were originally imported from THIS spec.
    // We don't track flow-level import provenance yet (no flows.import_spec_id column), so be
    // conservative: only flag flows whose name matches an absent x-mon flow from THIS spec — which
    // is empty since we just matched everything we found. Skipped: full "Removed from spec" flows
    // section in v1 to avoid accidentally suggesting deletion of user-authored flows.
    // (Listed under "removed.flows" only when round-trip provenance is unambiguous.)

    // Prereqs round-trip: find ops with x-mon-prereq: true.
    const matchedPrereqIds = new Set<string>();
    let prereqOrderIdx = 0;
    for (const { methKey, pathKey, op } of iterateOperations(rawDoc)) {
      if (!op["x-mon-prereq"]) continue;
      const httpMethod = methodToHttpMethod(methKey);
      if (!httpMethod) continue;
      const pathTemplate = pathTemplateToInternalSyntax(pathKey);
      const xPrereqId = op["x-mon-prereq-id"] || `${pathKey}#${methKey}`;
      const position = op["x-mon-prereq-order"] ?? ++prereqOrderIdx;
      const existing = existingPrereqs.find((p) => p.id === xPrereqId);
      if (existing) matchedPrereqIds.add(existing.id);
      prereqs.push({
        xMonPrereqId: xPrereqId,
        position,
        method: httpMethod,
        pathTemplate,
        status: existing ? "unchanged" : "new",
        existingPrereqId: existing?.id,
      });
    }
  }

  return {
    endpoints,
    authSchemes,
    flows,
    prereqs,
    removed: {
      urls: removedUrls,
      flows: removedFlows,
      prereqs: removedPrereqs,
    },
    warnings,
  };
}

// ===== Build addUrl input from an operation =====

function operationToUrlInput(
  doc: OpenAPIDocument,
  pathItem: PathItem,
  pathKey: string,
  methKey: MethodKey,
  op: Operation,
  ctx: {
    projectId: string;
    specId: string;
    baseUrlOverride?: string;
    specUrl?: string;
    apiKeyResolver: (schemeId: string) => string | null;
  },
): Parameters<typeof addUrl>[0] | null {
  const httpMethod = methodToHttpMethod(methKey);
  if (!httpMethod) return null;
  const pathTemplate = pathTemplateToInternalSyntax(pathKey);
  const baseUrl = pickBaseUrl(doc, pathItem, op, ctx.baseUrlOverride, ctx.specUrl);
  if (!baseUrl) return null;
  const fullUrl = joinUrl(baseUrl, pathTemplate);
  const identity = operationIdentity(httpMethod, pathTemplate, op.operationId);

  const merged = mergeParameters(pathItem, op);
  const customHeaders: KeyValue[] = op["x-mon-custom-headers"]?.length
    ? op["x-mon-custom-headers"]
    : paramsToHeaders(merged);
  const queryParams: KeyValue[] = op["x-mon-query-params"]?.length
    ? op["x-mon-query-params"]
    : paramsToQuery(merged);

  // Body — round-trip carries `x-mon-body*`; otherwise infer empty body.
  const bodyType: BodyType =
    (op["x-mon-body-type"] as BodyType) ||
    (op.requestBody?.content?.["application/json"] ? "json" : "none");
  const body = op["x-mon-body"] ?? "";
  const bodyContentType = op["x-mon-body-content-type"] ?? "";

  const authSchemeId = resolveAuthSchemeId(doc, op);
  const apiKeyId = authSchemeId ? ctx.apiKeyResolver(authSchemeId) : null;

  return {
    projectId: ctx.projectId,
    url: fullUrl,
    description: op.summary?.trim() || op.description?.trim() || op.operationId || "",
    apiKeyId,
    intervalMinutes: op["x-mon-interval-min"] ?? 5,
    method: httpMethod,
    bodyType,
    body,
    bodyContentType,
    assertions: buildDefaultAssertions(op),
    customHeaders,
    queryParams,
    importSource: identity,
    importSpecId: ctx.specId,
  };
}

// ===== Apply =====

export function applyImport(
  projectId: string,
  parsed: ParsedSpec,
  selections: ImportSelections,
): ImportResult {
  const result: ImportResult = {
    createdUrls: 0,
    createdFlows: 0,
    createdPrereqs: 0,
    createdApiKeys: 0,
    updatedUrls: 0,
    deletedUrls: 0,
    deletedFlows: 0,
    deletedPrereqs: 0,
    errors: [],
  };

  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");

  // Snapshot existing state once — apply is a single tx, so reading mid-flight is safe.
  const existingUrls = listUrlsByProject(projectId);
  const existingBySource = new Map<string, MonitoredUrl>();
  for (const u of existingUrls) {
    if (u.importSpecId === parsed.specId && u.importSource) {
      existingBySource.set(u.importSource, u);
    }
  }

  const wantedEndpointIds = new Set(selections.endpointIdentities);
  const wantedFlowIds = new Set(selections.flowIds);
  const wantedPrereqIds = new Set(selections.prereqIds);
  const wantedDeleteUrls = new Set(selections.deleteUrlIds);
  const wantedDeleteFlows = new Set(selections.deleteFlowIds);
  const wantedDeletePrereqs = new Set(selections.deletePrereqIds);

  try {
    tx(() => {
      // 1. Create new API key vault entries.
      const newKeyBySchemeId = new Map<string, string>(); // schemeId → new key id
      for (const create of selections.apiKeyCreates || []) {
        const k = addApiKey(projectId, {
          name: create.name,
          value: create.value || "",
          headerName: create.headerName,
          headerPrefix: create.headerPrefix,
        });
        if (k) {
          newKeyBySchemeId.set(create.schemeId, k.id);
          result.createdApiKeys += 1;
        }
      }

      // Re-read api keys so resolver sees both pre-existing and freshly-created.
      const refreshedProject = getProject(projectId)!;
      const apiKeyResolver = (schemeId: string): string | null => {
        if (newKeyBySchemeId.has(schemeId)) return newKeyBySchemeId.get(schemeId)!;
        const scheme = parsed.rawDoc.components?.securitySchemes?.[schemeId];
        const match = matchApiKey(scheme, schemeId, refreshedProject.apiKeys);
        return match.key?.id ?? null;
      };

      // 2. Create / overwrite URLs.
      for (const { methKey, pathKey, pathItem, op } of iterateOperations(parsed.rawDoc)) {
        const httpMethod = methodToHttpMethod(methKey);
        if (!httpMethod) continue;
        if (op.deprecated && !selections.includeDeprecated) continue;
        const pathTemplate = pathTemplateToInternalSyntax(pathKey);
        const identity = operationIdentity(httpMethod, pathTemplate, op.operationId);
        if (!wantedEndpointIds.has(identity)) continue;

        const input = operationToUrlInput(parsed.rawDoc, pathItem, pathKey, methKey, op, {
          projectId,
          specId: parsed.specId,
          baseUrlOverride: selections.baseUrlOverride,
          specUrl: parsed.specUrl,
          apiKeyResolver,
        });
        if (!input) {
          result.errors.push(
            `Skipped ${identity}: no resolvable server URL (set Base URL override).`,
          );
          continue;
        }

        const existing = existingBySource.get(identity);
        if (existing) {
          // Overwrite = remove existing, re-add. Keeps logic simple; assertions/headers/etc.
          // are all re-derived from the spec.
          removeUrl(existing.id);
          result.updatedUrls += 1;
        }
        try {
          addUrl(input);
          if (!existing) result.createdUrls += 1;
        } catch (err) {
          result.errors.push(
            `Failed to create URL ${identity}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // 3. Round-trip: Flows + Prereqs.
      if (parsed.isRoundTrip) {
        // Index ops by x-mon-step-id and x-mon-prereq-id for fast lookup.
        const opByStepId = new Map<string, { pathKey: string; methKey: MethodKey; op: Operation; pathItem: PathItem }>();
        const opByPrereqId = new Map<string, { pathKey: string; methKey: MethodKey; op: Operation; pathItem: PathItem }>();
        for (const entry of iterateOperations(parsed.rawDoc)) {
          if (entry.op["x-mon-step-id"]) opByStepId.set(entry.op["x-mon-step-id"], entry);
          if (entry.op["x-mon-prereq-id"]) opByPrereqId.set(entry.op["x-mon-prereq-id"], entry);
        }

        // 3a. Flows.
        const xFlows = parsed.rawDoc["x-mon-flows"] || [];
        const existingFlowsList = listFlowsByProject(projectId)
          .map((f) => getFlowWithSteps(f.id))
          .filter((f): f is FlowWithSteps => Boolean(f));
        for (const xf of xFlows) {
          if (!wantedFlowIds.has(xf.id)) continue;
          // Skip if a flow with the same name already exists (avoid dupes on re-import).
          const dupe = existingFlowsList.find(
            (f) => f.id === xf.id || f.name.toLowerCase() === (xf.name || "").toLowerCase(),
          );
          if (dupe) {
            // Don't auto-overwrite flows — they may have user edits. Skip + note.
            result.errors.push(
              `Skipped flow "${xf.name}": already exists (delete the existing flow first to re-import).`,
            );
            continue;
          }

          const flow = createFlow({
            projectId,
            name: xf.name || "Imported flow",
            description: xf.description || "",
            intervalMinutes: xf.intervalMinutes ?? 5,
            stopOnFailure: xf.stopOnFailure !== false,
            enabled: xf.enabled !== false,
          });

          // Add steps in position order.
          const sortedSteps = [...(xf.steps || [])].sort((a, b) => a.position - b.position);
          for (const sref of sortedSteps) {
            const kind = sref.stepType || "http";
            try {
              if (kind === "compute") {
                if (!sref.compute) continue;
                addFlowStep({
                  flowId: flow.id,
                  url: "",
                  description: sref.description || "",
                  stepType: "compute",
                  compute: sref.compute,
                  level: sref.level || 1,
                });
              } else if (kind === "loop") {
                if (!sref.forEach) continue;
                addFlowStep({
                  flowId: flow.id,
                  url: "",
                  description: sref.description || "",
                  stepType: "loop",
                  forEach: sref.forEach,
                  level: sref.level || 1,
                });
              } else {
                // HTTP — pull request details from the corresponding op in `paths:`.
                const opEntry = opByStepId.get(sref.stepId);
                if (!opEntry) {
                  result.errors.push(
                    `Flow "${xf.name}" step ${sref.position}: matching operation not found in paths (x-mon-step-id=${sref.stepId}).`,
                  );
                  continue;
                }
                const stepHttp = methodToHttpMethod(opEntry.methKey);
                if (!stepHttp) continue;
                const stepPathTemplate = pathTemplateToInternalSyntax(opEntry.pathKey);
                const baseUrl = pickBaseUrl(
                  parsed.rawDoc,
                  opEntry.pathItem,
                  opEntry.op,
                  selections.baseUrlOverride,
                  parsed.specUrl,
                );
                if (!baseUrl) {
                  result.errors.push(
                    `Flow "${xf.name}" step ${sref.position}: no server URL.`,
                  );
                  continue;
                }
                const merged = mergeParameters(opEntry.pathItem, opEntry.op);
                const stepAuthSchemeId = resolveAuthSchemeId(parsed.rawDoc, opEntry.op);
                const apiKeyId = stepAuthSchemeId ? apiKeyResolver(stepAuthSchemeId) : null;
                const meta = opEntry.op["x-mon-step"];
                addFlowStep({
                  flowId: flow.id,
                  url: joinUrl(baseUrl, stepPathTemplate),
                  description: sref.description || opEntry.op.summary || "",
                  method: stepHttp,
                  bodyType: (opEntry.op["x-mon-body-type"] as BodyType) || "none",
                  body: opEntry.op["x-mon-body"] || "",
                  bodyContentType: opEntry.op["x-mon-body-content-type"] || "",
                  apiKeyId,
                  assertions: opEntry.op["x-mon-assertions"] || meta?.assertions || [],
                  customHeaders: opEntry.op["x-mon-custom-headers"] || paramsToHeaders(merged),
                  queryParams: opEntry.op["x-mon-query-params"] || paramsToQuery(merged),
                  extractions: opEntry.op["x-mon-extractions"] || meta?.extractions || [],
                  waitBeforeMs: opEntry.op["x-mon-wait-before-ms"] || 0,
                  maxRetries: opEntry.op["x-mon-max-retries"] || 0,
                  retryBackoffMs: opEntry.op["x-mon-retry-backoff-ms"] || 1000,
                  forEach: sref.forEach || null,
                  stepType: "http",
                  level: sref.level || 1,
                });
              }
            } catch (err) {
              result.errors.push(
                `Flow "${xf.name}" step ${sref.position}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          result.createdFlows += 1;
        }

        // 3b. Prereqs.
        const existingPrereqsList = listPrereqSteps(projectId);
        for (const { op, pathKey, methKey, pathItem } of iterateOperations(parsed.rawDoc)) {
          if (!op["x-mon-prereq"]) continue;
          const xPrereqId = op["x-mon-prereq-id"] || `${pathKey}#${methKey}`;
          if (!wantedPrereqIds.has(xPrereqId)) continue;
          if (existingPrereqsList.some((p) => p.id === xPrereqId)) continue; // already there

          const httpMethod = methodToHttpMethod(methKey);
          if (!httpMethod) continue;
          const pathTemplate = pathTemplateToInternalSyntax(pathKey);
          const baseUrl = pickBaseUrl(parsed.rawDoc, pathItem, op, selections.baseUrlOverride, parsed.specUrl);
          if (!baseUrl) {
            result.errors.push(`Prereq ${xPrereqId}: no server URL.`);
            continue;
          }
          const merged = mergeParameters(pathItem, op);
          const preAuthSchemeId = resolveAuthSchemeId(parsed.rawDoc, op);
          const apiKeyId = preAuthSchemeId ? apiKeyResolver(preAuthSchemeId) : null;
          try {
            addPrereqStep({
              projectId,
              url: joinUrl(baseUrl, pathTemplate),
              description: op.summary?.trim() || op.description?.trim() || "",
              method: httpMethod,
              bodyType: (op["x-mon-body-type"] as BodyType) || "none",
              body: op["x-mon-body"] || "",
              bodyContentType: op["x-mon-body-content-type"] || "",
              apiKeyId,
              assertions: op["x-mon-assertions"] || [],
              customHeaders: op["x-mon-custom-headers"] || paramsToHeaders(merged),
              queryParams: op["x-mon-query-params"] || paramsToQuery(merged),
              extractions: op["x-mon-extractions"] || [],
              waitBeforeMs: op["x-mon-wait-before-ms"] || 0,
              maxRetries: op["x-mon-max-retries"] || 0,
              retryBackoffMs: op["x-mon-retry-backoff-ms"] || 1000,
              stepType: "http",
            });
            result.createdPrereqs += 1;
          } catch (err) {
            result.errors.push(
              `Prereq ${xPrereqId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      // 4. Apply deletions (selected by user from "Removed from spec" section).
      for (const id of wantedDeleteUrls) {
        if (removeUrl(id)) result.deletedUrls += 1;
      }
      for (const id of wantedDeleteFlows) {
        if (deleteFlow(id)) result.deletedFlows += 1;
      }
      for (const id of wantedDeletePrereqs) {
        if (deletePrereqStep(id)) result.deletedPrereqs += 1;
      }
    });
  } catch (err) {
    // Whole tx rolled back. Reset counters since nothing was persisted.
    return {
      createdUrls: 0,
      createdFlows: 0,
      createdPrereqs: 0,
      createdApiKeys: 0,
      updatedUrls: 0,
      deletedUrls: 0,
      deletedFlows: 0,
      deletedPrereqs: 0,
      errors: [
        ...result.errors,
        `Import rolled back: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  return result;
}

/** Convenience — list existing URLs from this spec (used by route to feed diff). */
export function getExistingUrlsForSpec(projectId: string, specId: string): MonitoredUrl[] {
  return getUrlsByImportSpec(projectId, specId);
}
