export type StatusGroup = "2xx" | "3xx" | "4xx" | "5xx" | "error";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";
export type BodyType = "none" | "json" | "form" | "urlencoded" | "raw" | "binary";

export interface Upload {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

/** Stored in a step's `body` (as JSON) when bodyType === "binary". */
export interface BinaryBodyConfig {
  uploadId: string;
  fieldName?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  value: string;
  headerName: string;
  headerPrefix: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  slackWebhookUrl: string;
  /** Phase 1.27.13 — dedicated Slack webhook for latency-only failures. Empty = use general webhook. */
  latencySlackWebhookUrl: string;
  /** Comma/semicolon/newline-separated email recipients for general (non-latency) failures + audit notifications. */
  notificationEmails: string;
  /** Phase 1.27.2 — recipients for failures caused solely by `latency-under` assertions. Empty = use general list. */
  latencyFailureEmails: string;
  apiKeys: ApiKey[];
  prereqIntervalMinutes: number;
  prereqEnabled: boolean;
  prereqLastRunAt: number | null;
  prereqLastRunOk: boolean | null;
  prereqLastRunTotalMs: number | null;
  createdAt: string;
}

export interface Timings {
  dnsMs: number | null;
  tcpMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  downloadMs: number | null;
  totalMs: number | null;
}

export type AssertionType =
  | "status-equals"
  | "status-in-range"
  | "latency-under"
  | "body-contains";

export interface Assertion {
  id: string;
  type: AssertionType;
  config: Record<string, any>;
}

export interface AssertionResult {
  id: string;
  type: AssertionType;
  passed: boolean;
  detail: string;
}

export interface KeyValue {
  key: string;
  value: string;
}

export interface MonitoredUrl {
  id: string;
  projectId: string;
  url: string;
  description: string;
  apiKeyId: string | null;
  intervalMinutes: number;
  method: HttpMethod;
  bodyType: BodyType;
  body: string;
  bodyContentType: string;
  assertions: Assertion[];
  customHeaders: KeyValue[];
  queryParams: KeyValue[];

  // Phase 1.27.3 — Per-URL retry / wait (0 = single-shot, pre-1.27.3 behaviour).
  waitBeforeMs: number;
  maxRetries: number;
  retryBackoffMs: number;

  // Phase 1.26 — Swagger import provenance. NULL = manually created.
  importSource: string | null;
  importSpecId: string | null;

  statusCode: number | null;
  statusGroup: StatusGroup | null;
  errorReason: string | null;
  timings: Timings | null;
  lastChecked: string | null;
  lastAssertionResults: AssertionResult[];
}

// =============================================================
// Swagger / OpenAPI import (Phase 1.26)
// Mirrors backend openapiImport.ts public types.
// =============================================================

export type ImportDiffStatus = "new" | "unchanged" | "drifted" | "removed";

export interface ImportEndpointPreview {
  identity: string;
  method: HttpMethod;
  pathTemplate: string;
  fullUrl: string;
  summary: string;
  deprecated: boolean;
  authSchemeId: string | null;
  status: ImportDiffStatus;
  existingUrlId?: string;
  driftReason?: string;
}

export interface ImportAuthSchemePreview {
  schemeId: string;
  type: "http-bearer" | "apiKey-header" | "unsupported";
  unsupportedKind?: string;
  headerName?: string;
  matchedApiKeyId: string | null;
  matchReason: "name" | "header-tuple" | "none";
}

export interface ImportFlowPreview {
  xMonFlowId: string;
  name: string;
  stepCount: number;
  status: ImportDiffStatus;
  existingFlowId?: string;
}

export interface ImportPrereqPreview {
  xMonPrereqId: string;
  position: number;
  method: HttpMethod;
  pathTemplate: string;
  status: ImportDiffStatus;
  existingPrereqId?: string;
}

export interface ImportDiff {
  endpoints: ImportEndpointPreview[];
  authSchemes: ImportAuthSchemePreview[];
  flows: ImportFlowPreview[];
  prereqs: ImportPrereqPreview[];
  removed: {
    urls: Array<{ id: string; url: string; method: HttpMethod; importSource: string | null }>;
    flows: Array<{ id: string; name: string }>;
    prereqs: Array<{ id: string; position: number; url: string }>;
  };
  warnings: string[];
}

export interface ImportPreview {
  diff: ImportDiff;
  specMeta: {
    title: string;
    version: string;
    specId: string;
    isRoundTrip: boolean;
  };
}

export interface ImportApiKeyCreate {
  schemeId: string;
  name: string;
  headerName: string;
  headerPrefix: string;
  value: string;
}

export interface ImportSelections {
  endpointIdentities: string[];
  flowIds: string[];
  prereqIds: string[];
  deleteUrlIds: string[];
  deleteFlowIds: string[];
  deletePrereqIds: string[];
  apiKeyCreates: ImportApiKeyCreate[];
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

export interface CheckRecord {
  id: string;
  urlId: string;
  statusCode: number | null;
  statusGroup: StatusGroup | null;
  errorReason: string | null;
  timings: Timings;
  assertionResults: AssertionResult[];
  ok: boolean;
  checkedAt: number;
}

export interface UrlStats {
  urlId: string;
  windowMinutes: number;
  total: number;
  failures: number;
  failureRatePct: number;
  avgLatencyMs: number | null;
  p99LatencyMs: number | null;
}

export interface SparklinePoint {
  bucketStart: number;
  avgLatencyMs: number | null;
  failures: number;
  total: number;
}

export interface AuditResult {
  projectId: string;
  reportFilename: string;
  reportUrl: string;
  totalUrls: number;
  failingUrls: number;
  okUrls: number;
  totalFlows: number;
  failingFlows: number;
  okFlows: number;
  slack: { posted: boolean; reason?: string };
}

export interface FullSnapshot {
  projects: Project[];
  urls: MonitoredUrl[];
  groups: Record<StatusGroup, number>;
  total: number;
  lastUpdated: string;
}

// ===== Flows =====

export type ExtractionSource = "body" | "header" | "status";

export interface Extraction {
  id: string;
  source: ExtractionSource;
  path: string;
  saveAs: string;
  ttlSeconds?: number | null;
}

/**
 * For-each iteration over a prior step's array response.
 * When set on a FlowStep, the step runs once per element of `arrayVarName`
 * (capped at 100 per level server-side; 10,000 total per run). The current
 * element is bound to `itemVarName` so templates like `{{student.id}}` resolve
 * per iteration.
 *
 * Phase 1.19: `arrayVarName` may be a dotted path against an outer loop's
 * item (e.g. `student.subjects`) to nest loops up to 4 levels deep.
 */
export interface ForEachConfig {
  arrayVarName: string;
  itemVarName: string;
}

/**
 * Phase 1.21 — Compute step. Mirrors backend ComputeTransform / ComputeRow /
 * ComputeConfig exactly; see backend/src/types.ts for the why.
 */
export type ComputeTransform =
  | { kind: "splitTake"; separator: string; index: number }
  | { kind: "slice"; start: number; end?: number }
  | { kind: "lowercase" }
  | { kind: "uppercase" }
  | { kind: "trim" }
  | { kind: "replace"; find: string; replace: string }
  | { kind: "concat"; template: string }
  | { kind: "mapAddField"; fieldName: string; sourceField: string; inner: ComputeTransform }
  | { kind: "concatArrays"; sources: string[] };

export interface ComputeRow {
  saveAs: string;
  source: string;
  transform: ComputeTransform;
}

export interface ComputeConfig {
  computations: ComputeRow[];
}

export type StepType = "http" | "compute" | "loop";

export interface FlowStep {
  id: string;
  flowId: string;
  position: number;
  description: string;
  url: string;
  method: HttpMethod;
  bodyType: BodyType;
  body: string;
  bodyContentType: string;
  apiKeyId: string | null;
  customHeaders: KeyValue[];
  queryParams: KeyValue[];
  assertions: Assertion[];
  extractions: Extraction[];
  waitBeforeMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  /** Phase 1.18 — when set, this step iterates over the named array variable. */
  forEach: ForEachConfig | null;
  /** Phase 1.21 — defaults to "http" when absent (every step pre-1.21). */
  stepType?: StepType;
  /** Phase 1.21 — populated only when stepType === "compute". */
  compute?: ComputeConfig | null;
  /**
   * Phase 1.23 — explicit nesting level 1..4. A level-N step renders and
   * executes as a child of the most-recent preceding level-(N-1) step.
   * Defaults to 1 (top-level) for pre-1.23 rows.
   */
  level: number;
}

/** Phase 1.21 — sample-vars endpoint response feeding the URL preview panel. */
export interface FlowSampleVars {
  variables: Record<string, unknown>;
  iterables: Record<string, string>;
  hasSample: boolean;
}

export interface Flow {
  id: string;
  projectId: string;
  name: string;
  description: string;
  intervalMinutes: number;
  stopOnFailure: boolean;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunOk: boolean | null;
  lastRunTotalMs: number | null;
  createdAt: string;
}

export interface FlowWithSteps extends Flow {
  steps: FlowStep[];
}

export interface ExtractedValue {
  saveAs: string;
  /**
   * String for scalar extractions; array for `[*]` wildcard extractions (Phase 1.18).
   * Persisted as JSON when serialized.
   */
  value: string | unknown[];
  fromCache: boolean;
}

export interface StepResult {
  id: string;
  flowRunId: string;
  stepId: string;
  position: number;
  statusCode: number | null;
  statusGroup: StatusGroup | null;
  errorReason: string | null;
  timings: Timings;
  assertionResults: AssertionResult[];
  extractedValues: ExtractedValue[];
  attempts: number;
  skipped: boolean;
  skipReason: string | null;
  ok: boolean;
  checkedAt: number;
  /**
   * Phase 1.18 — non-null on depth-1 iteration rows. `iterationIndex` is 0..N-1;
   * `iterationCount` is N (same on every row of the same iteration set).
   * Phase 1.19: NULL on depth >1 rows — use `iterationPath` instead.
   */
  iterationIndex: number | null;
  iterationCount: number | null;
  /**
   * Phase 1.19 — 0-indexed path through nested loops (e.g. `[2, 0, 3]` =
   * "3rd outer × 1st mid × 4th inner"). NULL for non-iterating rows and
   * depth-1 rows (which use `iterationIndex` for back-compat).
   */
  iterationPath: number[] | null;
  /** Phase 1.19 — per-level totals matching `iterationPath` (e.g. `[10, 12, 8]`). */
  iterationPathCount: number[] | null;
  /**
   * Phase 1.19.1 — the URL actually fetched after {{var}} substitution.
   * NULL for skipped/sentinel rows and for pre-1.19.1 rows.
   */
  resolvedUrl: string | null;
}

/**
 * Mid-flight progress for the step currently executing in a run. Only present
 * on FlowRun / PrereqRun responses while `endedAt == null`. Lets the UI show
 * "🔁 Retry 2 of 4 — waiting 1.5s…" instead of an opaque spinner during backoff.
 */
export interface LiveStepProgress {
  stepId: string;
  position: number;
  attempt: number;       // 1-indexed: 1 = first try, 2 = first retry, …
  maxAttempts: number;   // maxRetries + 1
  lastStatusCode: number | null;
  lastErrorReason: string | null;
  phase: "executing" | "backoff";
  nextRetryAtMs: number | null;
  /** Phase 1.18 — 1-indexed iteration counter during a depth-1 for-each step. null when not iterating. */
  forEachIteration?: number | null;
  /** Phase 1.18 — total iterations being run (already clamped to the 100 cap). */
  forEachTotal?: number | null;
  /**
   * Phase 1.19 — 1-indexed nested-iteration path (e.g. `[3, 7, 2]` = "outer iter 3,
   * mid iter 7, inner iter 2"). Always populated when iterating (depth ≥ 1).
   */
  forEachPath?: number[] | null;
  /** Phase 1.19 — per-level totals matching `forEachPath` (e.g. `[10, 12, 8]`). */
  forEachTotalPath?: number[] | null;
}

export interface FlowRun {
  id: string;
  flowId: string;
  startedAt: number;
  endedAt: number | null;
  ok: boolean;
  failedAtStepId: string | null;
  totalMs: number | null;
  variables: Record<string, string>;
  stepResults: StepResult[];
  /** Present only while a run is in-flight. */
  liveStep?: LiveStepProgress | null;
}

// ===== Prerequisites (project-level setup chain) =====

export interface PrereqStep {
  id: string;
  projectId: string;
  position: number;
  description: string;
  url: string;
  method: HttpMethod;
  bodyType: BodyType;
  body: string;
  bodyContentType: string;
  apiKeyId: string | null;
  customHeaders: KeyValue[];
  queryParams: KeyValue[];
  assertions: Assertion[];
  extractions: Extraction[];
  waitBeforeMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  /** Phase 1.21 — defaults to "http" when absent. */
  stepType?: StepType;
  /** Phase 1.21 — populated only when stepType === "compute". */
  compute?: ComputeConfig | null;
}

export interface PrereqsBundle {
  steps: PrereqStep[];
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunOk: boolean | null;
  lastRunTotalMs: number | null;
}

export interface PrereqRun {
  id: string;
  projectId: string;
  startedAt: number;
  endedAt: number | null;
  ok: boolean;
  failedAtStepId: string | null;
  totalMs: number | null;
  variables: Record<string, string>;
  stepResults: StepResult[];
  /** Present only while a run is in-flight. */
  liveStep?: LiveStepProgress | null;
}

export interface ProjectVariable {
  name: string;
  value: string;
  capturedAt: number;
  expiresAt: number | null;
}
