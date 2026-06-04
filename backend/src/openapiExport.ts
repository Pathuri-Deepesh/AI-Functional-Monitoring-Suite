/**
 * Phase 1.24 — Export a project's monitors + flows + prereqs as an OpenAPI 3.0.3 document.
 *
 * Hybrid encoding:
 *  - Every HTTP step (URL monitor, flow step, prereq step) becomes a Swagger `paths` entry,
 *    with our orchestration metadata carried in `x-mon-*` extensions on the operation.
 *  - A top-level `x-mon-flows` side-band lists every flow in position order. This is the
 *    only place Compute and Loop steps appear (Swagger has no concept of a non-HTTP node).
 *
 * Determinism: paths are alphabetically sorted; steps inside `x-mon-flows[*].steps` are in
 * position order. Re-exporting the same project yields a byte-identical file.
 *
 * No sample/recorded data is included — this is a contract spec, not a snapshot.
 */
import type {
  Project,
  ApiKey,
  MonitoredUrl,
  FlowStep,
  FlowWithSteps,
  PrereqStep,
  Assertion,
  Extraction,
  ForEachConfig,
  ComputeConfig,
  KeyValue,
} from "./types";

// ===== Minimal OpenAPI 3.0.3 shape (only what we emit) =====

interface OpenAPIDocument {
  openapi: "3.0.3";
  info: { title: string; description?: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, PathItem>;
  components?: { securitySchemes?: Record<string, SecurityScheme> };
  ["x-mon-flows"]?: XMonFlow[];
  ["x-mon-project-id"]: string;
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
}

interface Operation {
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  security?: Array<Record<string, string[]>>;
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
  in: "path" | "query" | "header";
  required: boolean;
  schema: { type: "string" };
}

interface RequestBody {
  required: boolean;
  content: Record<string, { schema: { type: "string" } }>;
}

interface Response {
  description: string;
}

type SecurityScheme =
  | { type: "http"; scheme: "bearer" }
  | { type: "apiKey"; in: "header"; name: string };

interface XMonFlow {
  id: string;
  name: string;
  description: string;
  intervalMinutes: number;
  stopOnFailure: boolean;
  enabled: boolean;
  steps: XMonFlowStepRef[];
}

interface XMonFlowStepRef {
  position: number;
  level: number;
  stepType: "http" | "compute" | "loop";
  description: string;
  // For HTTP steps — pointer back to the path emitted in `paths:`
  method?: string;
  path?: string;
  server?: string;
  // For all steps — full metadata so the flow is self-contained
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

// ===== Helpers =====

/** Strip the `scheme://host[:port]` portion off a full URL, returning both pieces. Falls back gracefully on malformed inputs. */
function splitServerAndPath(fullUrl: string): { server: string; path: string } {
  // Resolve `{{var}}` substitution markers temporarily so URL() can parse — we keep the original substring in the output.
  const placeholderSafe = fullUrl.replace(/\{\{([^}]+)\}\}/g, "__VAR_$1__");
  try {
    const u = new URL(placeholderSafe);
    const server = `${u.protocol}//${u.host}`;
    const pathRaw = u.pathname + (u.search || "");
    const path = pathRaw.replace(/__VAR_([^_]+)__/g, "{{$1}}");
    return { server, path };
  } catch {
    // Relative or unparseable — emit as-is under an "unknown" server
    return { server: "", path: fullUrl };
  }
}

/** Normalize a `{{var.subfield}}` placeholder name into an OpenAPI-legal identifier (dots → underscores). */
function normalizeVarName(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Convert our `{{var}}` syntax into OpenAPI path templating `{var}` for the `paths:` key. */
function toOpenAPIPathKey(path: string): string {
  // OpenAPI requires path templating like `/users/{id}`. Our `{{var}}` becomes `{var}`.
  // Query strings get stripped from the key (they live in `parameters` if needed).
  // Dots in `{{a.b}}` become underscores so `{{campaign.id}}` and `{{campaign.locale}}` stay distinct.
  const noQuery = path.split("?")[0];
  return noQuery.replace(/\{\{([^}]+)\}\}/g, (_m, name) => `{${normalizeVarName(name)}}`);
}

/** Extract `{{var}}` placeholders from a URL template and emit OpenAPI path params. */
function templateVarsToPathParams(path: string): Parameter[] {
  const seen = new Set<string>();
  const params: Parameter[] = [];
  const re = /\{\{([^}]+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path.split("?")[0])) !== null) {
    const name = normalizeVarName(m[1]);
    if (seen.has(name)) continue;
    seen.add(name);
    params.push({ name, in: "path", required: true, schema: { type: "string" } });
  }
  return params;
}

/** Pick a stable `securitySchemes` id for an ApiKey, then derive the scheme object. */
function apiKeyToSchemeId(key: ApiKey): string {
  // Lowercase + slug — `Bearer Token` → `bearer-token`.
  return key.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `apikey-${key.id.slice(0, 8)}`;
}

function apiKeyToScheme(key: ApiKey): SecurityScheme {
  const headerLower = key.headerName.toLowerCase();
  const prefixLower = (key.headerPrefix || "").trim().toLowerCase();
  if (headerLower === "authorization" && prefixLower.startsWith("bearer")) {
    return { type: "http", scheme: "bearer" };
  }
  return { type: "apiKey", in: "header", name: key.headerName };
}

function buildSecuritySchemes(project: Project): Record<string, SecurityScheme> {
  const out: Record<string, SecurityScheme> = {};
  for (const k of project.apiKeys) {
    out[apiKeyToSchemeId(k)] = apiKeyToScheme(k);
  }
  return out;
}

function findApiKey(project: Project, apiKeyId: string | null): ApiKey | undefined {
  if (!apiKeyId) return undefined;
  return project.apiKeys.find((k) => k.id === apiKeyId);
}

function extractServers(
  urls: MonitoredUrl[],
  flows: FlowWithSteps[],
  prereqs: PrereqStep[],
): string[] {
  const seen = new Set<string>();
  const push = (raw: string) => {
    // Sentinel scheme prefixes used by compute/loop steps are not real servers.
    if (!raw || raw.startsWith("compute://") || raw.startsWith("loop://")) return;
    const { server } = splitServerAndPath(raw);
    if (server) seen.add(server);
  };
  urls.forEach((u) => push(u.url));
  prereqs
    .filter((p) => (p.stepType ?? "http") === "http")
    .forEach((p) => push(p.url));
  flows.forEach((f) =>
    f.steps.filter((s) => (s.stepType ?? "http") === "http").forEach((s) => push(s.url)),
  );
  return Array.from(seen).sort();
}

/** Choose the lowercase HTTP method key OpenAPI expects, defaulting to GET for safety. */
function methodKey(method: string): "get" | "post" | "put" | "patch" {
  const m = (method || "GET").toLowerCase();
  if (m === "post" || m === "put" || m === "patch") return m;
  return "get";
}

/** Build the common request shape (parameters, body, security) shared by URLs / flow steps / prereqs. */
function buildRequestSurface(
  project: Project,
  spec: {
    url: string;
    apiKeyId: string | null;
    customHeaders: KeyValue[];
    queryParams: KeyValue[];
    bodyType: string;
    body: string;
    bodyContentType: string;
  },
): {
  parameters: Parameter[];
  requestBody?: RequestBody;
  security?: Array<Record<string, string[]>>;
  xMonAuthSchemeId?: string;
} {
  const { path } = splitServerAndPath(spec.url);
  const parameters: Parameter[] = templateVarsToPathParams(path);

  // Surface customHeaders and queryParams as OpenAPI parameters too (purely descriptive).
  for (const h of spec.customHeaders || []) {
    if (!h.key) continue;
    parameters.push({ name: h.key, in: "header", required: false, schema: { type: "string" } });
  }
  for (const q of spec.queryParams || []) {
    if (!q.key) continue;
    parameters.push({ name: q.key, in: "query", required: false, schema: { type: "string" } });
  }

  let requestBody: RequestBody | undefined;
  if (spec.bodyType && spec.bodyType !== "none") {
    const ct =
      spec.bodyContentType ||
      (spec.bodyType === "json" ? "application/json" : spec.bodyType === "form" ? "multipart/form-data" : "text/plain");
    requestBody = { required: false, content: { [ct]: { schema: { type: "string" } } } };
  }

  let security: Array<Record<string, string[]>> | undefined;
  let xMonAuthSchemeId: string | undefined;
  const key = findApiKey(project, spec.apiKeyId);
  if (key) {
    const id = apiKeyToSchemeId(key);
    security = [{ [id]: [] }];
    xMonAuthSchemeId = id;
  }
  return { parameters, requestBody, security, xMonAuthSchemeId };
}

function buildOperationForUrl(project: Project, url: MonitoredUrl): Operation {
  const req = buildRequestSurface(project, url);
  const op: Operation = {
    summary: url.description || `URL monitor ${url.id.slice(0, 8)}`,
    parameters: req.parameters.length ? req.parameters : undefined,
    requestBody: req.requestBody,
    responses: { default: { description: "Monitor target — status code asserted by x-mon-assertions" } },
    security: req.security,
    ["x-mon-url-id"]: url.id,
    ["x-mon-interval-min"]: url.intervalMinutes,
    ["x-mon-assertions"]: url.assertions?.length ? url.assertions : undefined,
    ["x-mon-custom-headers"]: url.customHeaders?.length ? url.customHeaders : undefined,
    ["x-mon-query-params"]: url.queryParams?.length ? url.queryParams : undefined,
    ["x-mon-body-type"]: url.bodyType !== "none" ? url.bodyType : undefined,
    ["x-mon-body"]: url.body || undefined,
    ["x-mon-body-content-type"]: url.bodyContentType || undefined,
  };
  return pruneUndef(op);
}

function buildOperationForFlowStep(
  project: Project,
  flow: FlowWithSteps,
  step: FlowStep,
): Operation {
  const req = buildRequestSurface(project, step);
  const op: Operation = {
    summary: step.description || `${flow.name} — step ${step.position}`,
    parameters: req.parameters.length ? req.parameters : undefined,
    requestBody: req.requestBody,
    responses: { default: { description: `Flow ${flow.name} step ${step.position}` } },
    security: req.security,
    ["x-mon-step-id"]: step.id,
    ["x-mon-assertions"]: step.assertions?.length ? step.assertions : undefined,
    ["x-mon-extractions"]: step.extractions?.length ? step.extractions : undefined,
    ["x-mon-custom-headers"]: step.customHeaders?.length ? step.customHeaders : undefined,
    ["x-mon-query-params"]: step.queryParams?.length ? step.queryParams : undefined,
    ["x-mon-wait-before-ms"]: step.waitBeforeMs || undefined,
    ["x-mon-max-retries"]: step.maxRetries || undefined,
    ["x-mon-retry-backoff-ms"]: step.retryBackoffMs || undefined,
    ["x-mon-body-type"]: step.bodyType !== "none" ? step.bodyType : undefined,
    ["x-mon-body"]: step.body || undefined,
    ["x-mon-body-content-type"]: step.bodyContentType || undefined,
    ["x-mon-step"]: {
      flowId: flow.id,
      flowName: flow.name,
      position: step.position,
      level: step.level,
      stepType: (step.stepType as "http" | "compute" | "loop") || "http",
      forEach: step.forEach || undefined,
      extractions: step.extractions?.length ? step.extractions : undefined,
      assertions: step.assertions?.length ? step.assertions : undefined,
    },
  };
  return pruneUndef(op);
}

function buildOperationForPrereq(project: Project, prereq: PrereqStep): Operation {
  const req = buildRequestSurface(project, prereq);
  const op: Operation = {
    summary: prereq.description || `Prereq ${prereq.position}`,
    parameters: req.parameters.length ? req.parameters : undefined,
    requestBody: req.requestBody,
    responses: { default: { description: `Project prereq step ${prereq.position}` } },
    security: req.security,
    ["x-mon-prereq"]: true,
    ["x-mon-prereq-id"]: prereq.id,
    ["x-mon-prereq-order"]: prereq.position,
    ["x-mon-assertions"]: prereq.assertions?.length ? prereq.assertions : undefined,
    ["x-mon-extractions"]: prereq.extractions?.length ? prereq.extractions : undefined,
    ["x-mon-custom-headers"]: prereq.customHeaders?.length ? prereq.customHeaders : undefined,
    ["x-mon-query-params"]: prereq.queryParams?.length ? prereq.queryParams : undefined,
    ["x-mon-wait-before-ms"]: prereq.waitBeforeMs || undefined,
    ["x-mon-max-retries"]: prereq.maxRetries || undefined,
    ["x-mon-retry-backoff-ms"]: prereq.retryBackoffMs || undefined,
    ["x-mon-body-type"]: prereq.bodyType !== "none" ? prereq.bodyType : undefined,
    ["x-mon-body"]: prereq.body || undefined,
    ["x-mon-body-content-type"]: prereq.bodyContentType || undefined,
  };
  return pruneUndef(op);
}

/** Merge a new operation into the paths map under <path, method>. If a collision exists on the same method, the existing entry wins (HTTP method already differs per call, so collisions are rare; we prefer determinism over overwrites). */
function mergeOperation(
  paths: Record<string, PathItem>,
  pathKey: string,
  method: "get" | "post" | "put" | "patch",
  op: Operation,
): void {
  if (!paths[pathKey]) paths[pathKey] = {};
  if (paths[pathKey][method]) {
    // Path+method collision. Disambiguate by appending the step/url id as a synthetic path segment so neither operation is lost.
    const tag =
      op["x-mon-step-id"] ||
      op["x-mon-url-id"] ||
      op["x-mon-prereq-id"] ||
      Math.random().toString(36).slice(2, 8);
    const aliasKey = `${pathKey}#${tag.slice(0, 8)}`;
    if (!paths[aliasKey]) paths[aliasKey] = {};
    paths[aliasKey][method] = op;
    return;
  }
  paths[pathKey][method] = op;
}

function buildXMonFlow(flow: FlowWithSteps): XMonFlow {
  const sorted = [...flow.steps].sort((a, b) => a.position - b.position);
  const steps: XMonFlowStepRef[] = sorted.map((s) => {
    const kind = (s.stepType as "http" | "compute" | "loop") || "http";
    const ref: XMonFlowStepRef = {
      position: s.position,
      level: s.level,
      stepType: kind,
      description: s.description || "",
      stepId: s.id,
      forEach: s.forEach || undefined,
      compute: s.compute || undefined,
    };
    if (kind === "http" && s.url) {
      const { server, path } = splitServerAndPath(s.url);
      ref.method = (s.method || "GET").toUpperCase();
      ref.path = toOpenAPIPathKey(path);
      ref.server = server || undefined;
    }
    return pruneUndef(ref) as XMonFlowStepRef;
  });
  return {
    id: flow.id,
    name: flow.name,
    description: flow.description || "",
    intervalMinutes: flow.intervalMinutes,
    stopOnFailure: flow.stopOnFailure,
    enabled: flow.enabled,
    steps,
  };
}

/** Remove undefined-valued keys recursively (one level deep is enough for our shapes). */
function pruneUndef<T extends Record<string, any>>(o: T): T {
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) delete o[k];
  }
  return o;
}

/** Return a new object with keys sorted alphabetically — applied to `paths:` for deterministic diffs. */
function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

// ===== Public API =====

export function buildOpenAPISpec(
  project: Project,
  urls: MonitoredUrl[],
  flows: FlowWithSteps[],
  prereqs: PrereqStep[],
): OpenAPIDocument {
  const paths: Record<string, PathItem> = {};

  // URL monitors → paths
  for (const u of urls) {
    const { path } = splitServerAndPath(u.url);
    const key = toOpenAPIPathKey(path);
    mergeOperation(paths, key, methodKey(u.method), buildOperationForUrl(project, u));
  }

  // Prereq steps → paths
  for (const p of prereqs) {
    if ((p.stepType ?? "http") !== "http") continue; // compute prereqs have no URL
    const { path } = splitServerAndPath(p.url);
    const key = toOpenAPIPathKey(path);
    mergeOperation(paths, key, methodKey(p.method), buildOperationForPrereq(project, p));
  }

  // Flow HTTP steps → paths (compute/loop live ONLY in x-mon-flows)
  for (const f of flows) {
    for (const s of f.steps) {
      const kind = s.stepType ?? "http";
      if (kind !== "http") continue;
      if (!s.url) continue;
      const { path } = splitServerAndPath(s.url);
      const key = toOpenAPIPathKey(path);
      mergeOperation(paths, key, methodKey(s.method), buildOperationForFlowStep(project, f, s));
    }
  }

  const servers = extractServers(urls, flows, prereqs).map((url) => ({ url }));
  const securitySchemes = buildSecuritySchemes(project);
  const xMonFlows = flows
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(buildXMonFlow);

  const doc: OpenAPIDocument = {
    openapi: "3.0.3",
    info: {
      title: project.name,
      description: project.description || `Monitoring suite export of project ${project.name}`,
      version: "1.0.0",
    },
    servers,
    paths: sortKeys(paths),
    components: Object.keys(securitySchemes).length ? { securitySchemes } : undefined as any,
    ["x-mon-project-id"]: project.id,
    ["x-mon-flows"]: xMonFlows.length ? xMonFlows : undefined,
  };
  // Final prune of top-level undefineds
  if (!doc.components) delete (doc as any).components;
  if (!doc["x-mon-flows"]) delete (doc as any)["x-mon-flows"];
  return doc;
}
