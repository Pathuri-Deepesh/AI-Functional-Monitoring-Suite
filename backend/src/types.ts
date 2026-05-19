export type StatusGroup = "2xx" | "3xx" | "4xx" | "5xx" | "error";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH";
export type BodyType = "none" | "json" | "form" | "urlencoded" | "raw";

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
  // For status-equals: { value: 200 }
  // For status-in-range: { min: 200, max: 299 }
  // For latency-under: { ms: 1000 }
  // For body-contains: { text: "order_id" }
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

  // Latest snapshot (denormalized for fast reads)
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
  checkedAt: number; // unix ms
}

export interface UrlStats {
  urlId: string;
  windowMinutes: number;
  total: number;
  failures: number;
  failureRatePct: number; // 0–100
  avgLatencyMs: number | null;
  p99LatencyMs: number | null;
}

export interface SparklinePoint {
  bucketStart: number; // unix ms
  avgLatencyMs: number | null;
  failures: number;
  total: number;
}

export interface FullSnapshot {
  projects: Project[];
  urls: MonitoredUrl[];
  groups: Record<StatusGroup, number>;
  total: number;
  lastUpdated: string;
}

// =============================================================
// FLOWS — chained API requests with variable extraction
// =============================================================

export type ExtractionSource = "body" | "header" | "status";

export interface Extraction {
  id: string;
  source: ExtractionSource;
  /** JSONPath like `$.auth.token` for body; header name for header; ignored for status. */
  path: string;
  /** Variable name (e.g. `auth_token`) — referenced as `{{auth_token}}` in later steps. */
  saveAs: string;
  /** Optional TTL in seconds; when set, the value is reused across flow runs while still fresh. */
  ttlSeconds?: number | null;
}

export interface FlowStep {
  id: string;
  flowId: string;
  position: number;
  description: string;

  // Request spec (mirrors MonitoredUrl)
  url: string;
  method: HttpMethod;
  bodyType: BodyType;
  body: string;
  bodyContentType: string;
  apiKeyId: string | null;
  customHeaders: KeyValue[];
  queryParams: KeyValue[];
  assertions: Assertion[];

  // Flow-specific
  extractions: Extraction[];
  /** Milliseconds to wait after the previous step finishes before sending this one. */
  waitBeforeMs: number;
  /** Number of retry attempts on failure (excluding the initial attempt). */
  maxRetries: number;
  /** Initial backoff between retries; doubled after each failed retry. */
  retryBackoffMs: number;
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
  /** OK state of the most recent run. null = never run. */
  lastRunOk: boolean | null;
  /** Duration of the most recent run (ms). null = never run. */
  lastRunTotalMs: number | null;
  createdAt: string;
}

export interface FlowWithSteps extends Flow {
  steps: FlowStep[];
}

export interface ExtractedValue {
  saveAs: string;
  value: string;
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
}

export interface FlowRun {
  id: string;
  flowId: string;
  startedAt: number;
  endedAt: number | null;
  ok: boolean;
  failedAtStepId: string | null;
  totalMs: number | null;
  /** Snapshot of all variables at run completion. */
  variables: Record<string, string>;
  stepResults: StepResult[];
}

export interface FlowStats {
  flowId: string;
  windowMinutes: number;
  totalRuns: number;
  failedRuns: number;
  failureRatePct: number;
  avgTotalMs: number | null;
}
