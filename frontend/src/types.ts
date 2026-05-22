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
  slackBotToken: string;
  slackChannel: string;
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
  statusCode: number | null;
  statusGroup: StatusGroup | null;
  errorReason: string | null;
  timings: Timings | null;
  lastChecked: string | null;
  lastAssertionResults: AssertionResult[];
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
 * Phase 1.18 — for-each iteration over a prior step's array response.
 * When set on a FlowStep, the step runs once per element of `arrayVarName`
 * (capped at 100 server-side). The current element is bound to `itemVarName`
 * so templates like `{{student.id}}` resolve per iteration.
 */
export interface ForEachConfig {
  arrayVarName: string;
  itemVarName: string;
}

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
   * Phase 1.18 — non-null on iteration rows of a for-each step. `iterationIndex`
   * is 0..N-1; `iterationCount` is N (the same on every row of the same iteration set).
   */
  iterationIndex: number | null;
  iterationCount: number | null;
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
  /** Phase 1.18 — 1-indexed iteration counter during a for-each step. null when not iterating. */
  forEachIteration?: number | null;
  /** Phase 1.18 — total iterations being run (already clamped to the 100 cap). */
  forEachTotal?: number | null;
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
