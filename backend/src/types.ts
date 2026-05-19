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
