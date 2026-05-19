import { randomUUID } from "node:crypto";
import { db, tx } from "./db.js";
import type {
  ApiKey,
  Assertion,
  AssertionResult,
  BodyType,
  CheckRecord,
  HttpMethod,
  KeyValue,
  MonitoredUrl,
  Project,
  SparklinePoint,
  StatusGroup,
  Timings,
  UrlStats,
} from "./types.js";

// ===== row mappers =====

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  slack_webhook_url: string;
  slack_bot_token: string;
  slack_channel: string;
  created_at: string;
}

interface ApiKeyRow {
  id: string;
  project_id: string;
  name: string;
  value: string;
  header_name: string;
  header_prefix: string;
}

interface UrlRow {
  id: string;
  project_id: string;
  url: string;
  description: string;
  api_key_id: string | null;
  interval_minutes: number;
  method: string;
  body_type: string;
  body: string;
  body_content_type: string | null;
  assertions_json: string;
  custom_headers_json: string | null;
  query_params_json: string | null;
  status_code: number | null;
  status_group: string | null;
  error_reason: string | null;
  timings_json: string | null;
  last_checked: string | null;
}

interface CheckRow {
  id: string;
  url_id: string;
  status_code: number | null;
  status_group: string | null;
  error_reason: string | null;
  dns_ms: number | null;
  tcp_ms: number | null;
  tls_ms: number | null;
  ttfb_ms: number | null;
  download_ms: number | null;
  total_ms: number | null;
  assertion_results_json: string;
  ok: number;
  checked_at: number;
}

function rowToApiKey(r: ApiKeyRow): ApiKey {
  return {
    id: r.id,
    name: r.name,
    value: r.value,
    headerName: r.header_name,
    headerPrefix: r.header_prefix,
  };
}

function rowToProject(r: ProjectRow): Project {
  const keys = db()
    .prepare("SELECT * FROM api_keys WHERE project_id = ? ORDER BY rowid")
    .all(r.id) as unknown as ApiKeyRow[];
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    slackWebhookUrl: r.slack_webhook_url,
    slackBotToken: r.slack_bot_token,
    slackChannel: r.slack_channel,
    apiKeys: keys.map(rowToApiKey),
    createdAt: r.created_at,
  };
}

function rowToUrl(r: UrlRow): MonitoredUrl {
  return {
    id: r.id,
    projectId: r.project_id,
    url: r.url,
    description: r.description,
    apiKeyId: r.api_key_id,
    intervalMinutes: r.interval_minutes,
    method: (r.method as HttpMethod) ?? "GET",
    bodyType: (r.body_type as BodyType) ?? "none",
    body: r.body ?? "",
    bodyContentType: r.body_content_type ?? "",
    assertions: safeParse<Assertion[]>(r.assertions_json, []),
    customHeaders: safeParse<KeyValue[]>(r.custom_headers_json, []),
    queryParams: safeParse<KeyValue[]>(r.query_params_json, []),
    statusCode: r.status_code,
    statusGroup: (r.status_group as StatusGroup | null) ?? null,
    errorReason: r.error_reason,
    timings: r.timings_json ? safeParse<Timings | null>(r.timings_json, null) : null,
    lastChecked: r.last_checked,
    lastAssertionResults: [], // populated on demand
  };
}

function rowToCheck(r: CheckRow): CheckRecord {
  return {
    id: r.id,
    urlId: r.url_id,
    statusCode: r.status_code,
    statusGroup: (r.status_group as StatusGroup | null) ?? null,
    errorReason: r.error_reason,
    timings: {
      dnsMs: r.dns_ms,
      tcpMs: r.tcp_ms,
      tlsMs: r.tls_ms,
      ttfbMs: r.ttfb_ms,
      downloadMs: r.download_ms,
      totalMs: r.total_ms,
    },
    assertionResults: safeParse<AssertionResult[]>(r.assertion_results_json, []),
    ok: r.ok === 1,
    checkedAt: r.checked_at,
  };
}

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

// ===== Projects =====

export function listProjects(): Project[] {
  const rows = db().prepare("SELECT * FROM projects ORDER BY created_at").all() as unknown as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | undefined {
  const row = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function createProject(input: {
  name: string;
  description?: string;
  slackWebhookUrl?: string;
  slackBotToken?: string;
  slackChannel?: string;
}): Project {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO projects (id, name, description, slack_webhook_url, slack_bot_token, slack_channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.name.trim() || "Untitled project",
      input.description?.trim() ?? "",
      input.slackWebhookUrl?.trim() ?? "",
      input.slackBotToken?.trim() ?? "",
      input.slackChannel?.trim() ?? "",
      createdAt
    );
  return getProject(id)!;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "description" | "slackWebhookUrl" | "slackBotToken" | "slackChannel">>
): Project | undefined {
  const existing = getProject(id);
  if (!existing) return undefined;
  db()
    .prepare(
      `UPDATE projects
       SET name = ?, description = ?, slack_webhook_url = ?, slack_bot_token = ?, slack_channel = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      patch.slackWebhookUrl ?? existing.slackWebhookUrl,
      patch.slackBotToken ?? existing.slackBotToken,
      patch.slackChannel ?? existing.slackChannel,
      id
    );
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const result = db().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

// ===== API Keys =====

export function addApiKey(
  projectId: string,
  input: { name: string; value: string; headerName?: string; headerPrefix?: string }
): ApiKey | undefined {
  const project = getProject(projectId);
  if (!project) return undefined;
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO api_keys (id, project_id, name, value, header_name, header_prefix)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      input.name.trim() || "Untitled key",
      input.value,
      input.headerName?.trim() || "Authorization",
      input.headerPrefix ?? "Bearer "
    );
  return {
    id,
    name: input.name.trim() || "Untitled key",
    value: input.value,
    headerName: input.headerName?.trim() || "Authorization",
    headerPrefix: input.headerPrefix ?? "Bearer ",
  };
}

export function removeApiKey(projectId: string, keyId: string): boolean {
  const result = db()
    .prepare("DELETE FROM api_keys WHERE id = ? AND project_id = ?")
    .run(keyId, projectId);
  return result.changes > 0;
}

// ===== URLs =====

export function listUrls(): MonitoredUrl[] {
  const rows = db().prepare("SELECT * FROM urls ORDER BY rowid DESC").all() as unknown as UrlRow[];
  return rows.map(rowToUrl);
}

export function listUrlsByProject(projectId: string): MonitoredUrl[] {
  const rows = db()
    .prepare("SELECT * FROM urls WHERE project_id = ? ORDER BY rowid DESC")
    .all(projectId) as unknown as UrlRow[];
  return rows.map(rowToUrl);
}

export function getUrl(id: string): MonitoredUrl | undefined {
  const row = db().prepare("SELECT * FROM urls WHERE id = ?").get(id) as UrlRow | undefined;
  return row ? rowToUrl(row) : undefined;
}

const ALLOWED_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH"];
const ALLOWED_BODY_TYPES: BodyType[] = ["none", "json", "form", "urlencoded", "raw"];

export function addUrl(input: {
  projectId: string;
  url: string;
  description?: string;
  apiKeyId?: string | null;
  intervalMinutes?: number;
  method?: HttpMethod;
  bodyType?: BodyType;
  body?: string;
  bodyContentType?: string;
  assertions?: Assertion[];
  customHeaders?: KeyValue[];
  queryParams?: KeyValue[];
}): MonitoredUrl {
  const project = getProject(input.projectId);
  if (!project) throw new Error("Project not found");

  const url = input.url.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http(s) URLs are supported");
    }
  } catch {
    throw new Error("Invalid URL");
  }

  if (input.apiKeyId && !project.apiKeys.some((k) => k.id === input.apiKeyId)) {
    throw new Error("API key does not belong to this project");
  }

  const method = input.method && ALLOWED_METHODS.includes(input.method) ? input.method : "GET";
  if ((input.method as string) === "DELETE") {
    throw new Error("DELETE method is not allowed for safety");
  }
  const bodyType =
    input.bodyType && ALLOWED_BODY_TYPES.includes(input.bodyType) ? input.bodyType : "none";

  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO urls (id, project_id, url, description, api_key_id, interval_minutes,
                         method, body_type, body, body_content_type, assertions_json,
                         custom_headers_json, query_params_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      url,
      input.description?.trim() ?? "",
      input.apiKeyId ?? null,
      Math.max(1, Math.min(60 * 24, Number(input.intervalMinutes ?? 5))),
      method,
      bodyType,
      input.body ?? "",
      (input.bodyContentType ?? "").trim(),
      JSON.stringify(input.assertions ?? []),
      JSON.stringify(cleanKv(input.customHeaders ?? [])),
      JSON.stringify(cleanKv(input.queryParams ?? []))
    );
  return getUrl(id)!;
}

function cleanKv(arr: KeyValue[]): KeyValue[] {
  return arr.filter((kv) => kv.key.trim().length > 0).map((kv) => ({
    key: kv.key.trim(),
    value: kv.value,
  }));
}

export function updateUrl(
  id: string,
  patch: Partial<
    Pick<
      MonitoredUrl,
      | "description"
      | "apiKeyId"
      | "intervalMinutes"
      | "url"
      | "method"
      | "bodyType"
      | "body"
      | "bodyContentType"
      | "assertions"
      | "customHeaders"
      | "queryParams"
    >
  >
): MonitoredUrl | undefined {
  const existing = getUrl(id);
  if (!existing) return undefined;
  if ((patch.method as string) === "DELETE") {
    throw new Error("DELETE method is not allowed for safety");
  }
  const method = patch.method && ALLOWED_METHODS.includes(patch.method) ? patch.method : existing.method;
  const bodyType =
    patch.bodyType && ALLOWED_BODY_TYPES.includes(patch.bodyType) ? patch.bodyType : existing.bodyType;
  db()
    .prepare(
      `UPDATE urls
       SET url = ?, description = ?, api_key_id = ?, interval_minutes = ?,
           method = ?, body_type = ?, body = ?, body_content_type = ?, assertions_json = ?,
           custom_headers_json = ?, query_params_json = ?
       WHERE id = ?`
    )
    .run(
      patch.url ?? existing.url,
      patch.description ?? existing.description,
      patch.apiKeyId !== undefined ? patch.apiKeyId : existing.apiKeyId,
      Math.max(1, Math.min(60 * 24, Number(patch.intervalMinutes ?? existing.intervalMinutes))),
      method,
      bodyType,
      patch.body ?? existing.body,
      (patch.bodyContentType ?? existing.bodyContentType ?? "").trim(),
      JSON.stringify(patch.assertions ?? existing.assertions),
      JSON.stringify(cleanKv(patch.customHeaders ?? existing.customHeaders)),
      JSON.stringify(cleanKv(patch.queryParams ?? existing.queryParams)),
      id
    );
  return getUrl(id);
}

export function removeUrl(id: string): boolean {
  const result = db().prepare("DELETE FROM urls WHERE id = ?").run(id);
  return result.changes > 0;
}

// Update the denormalized "latest snapshot" on the URL row + insert a check record
// in a single transaction.
export function recordCheck(args: {
  urlId: string;
  statusCode: number | null;
  statusGroup: StatusGroup | null;
  errorReason: string | null;
  timings: Timings;
  assertionResults: AssertionResult[];
  ok: boolean;
  checkedAt: number;
}): void {
  const lastChecked = new Date(args.checkedAt).toISOString();
  tx(() => {
    db()
      .prepare(
        `INSERT INTO checks (id, url_id, status_code, status_group, error_reason,
                             dns_ms, tcp_ms, tls_ms, ttfb_ms, download_ms, total_ms,
                             assertion_results_json, ok, checked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        args.urlId,
        args.statusCode,
        args.statusGroup,
        args.errorReason,
        args.timings.dnsMs,
        args.timings.tcpMs,
        args.timings.tlsMs,
        args.timings.ttfbMs,
        args.timings.downloadMs,
        args.timings.totalMs,
        JSON.stringify(args.assertionResults),
        args.ok ? 1 : 0,
        args.checkedAt
      );
    db()
      .prepare(
        `UPDATE urls
         SET status_code = ?, status_group = ?, error_reason = ?, timings_json = ?, last_checked = ?
         WHERE id = ?`
      )
      .run(
        args.statusCode,
        args.statusGroup,
        args.errorReason,
        JSON.stringify(args.timings),
        lastChecked,
        args.urlId
      );
  });
}

export function resolveApiKeyHeader(url: MonitoredUrl): { name: string; value: string } | null {
  if (!url.apiKeyId) return null;
  const project = getProject(url.projectId);
  if (!project) return null;
  const key = project.apiKeys.find((k) => k.id === url.apiKeyId);
  if (!key) return null;
  return { name: key.headerName, value: `${key.headerPrefix}${key.value}` };
}

// ===== History queries =====

export function listChecksForUrl(urlId: string, sinceMs: number): CheckRecord[] {
  const rows = db()
    .prepare("SELECT * FROM checks WHERE url_id = ? AND checked_at >= ? ORDER BY checked_at ASC")
    .all(urlId, sinceMs) as unknown as CheckRow[];
  return rows.map(rowToCheck);
}

export function getUrlStats(urlId: string, windowMinutes: number): UrlStats {
  const sinceMs = Date.now() - windowMinutes * 60_000;
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
              AVG(total_ms) AS avg_total
       FROM checks
       WHERE url_id = ? AND checked_at >= ?`
    )
    .get(urlId, sinceMs) as { total: number; failures: number | null; avg_total: number | null };

  const total = Number(row.total ?? 0);
  const failures = Number(row.failures ?? 0);
  const failureRatePct = total > 0 ? (failures / total) * 100 : 0;
  const avgLatencyMs = row.avg_total != null ? Math.round(Number(row.avg_total)) : null;

  // Approximate p99 by ordering; fine for our scale (few thousand rows max per URL/window)
  let p99LatencyMs: number | null = null;
  if (total > 0) {
    const totals = db()
      .prepare(
        "SELECT total_ms FROM checks WHERE url_id = ? AND checked_at >= ? AND total_ms IS NOT NULL ORDER BY total_ms ASC"
      )
      .all(urlId, sinceMs) as { total_ms: number }[];
    if (totals.length > 0) {
      const idx = Math.min(totals.length - 1, Math.floor(totals.length * 0.99));
      p99LatencyMs = totals[idx].total_ms;
    }
  }

  return {
    urlId,
    windowMinutes,
    total,
    failures,
    failureRatePct: Number(failureRatePct.toFixed(2)),
    avgLatencyMs,
    p99LatencyMs,
  };
}

export function getUrlSparkline(
  urlId: string,
  windowMinutes: number,
  buckets: number
): SparklinePoint[] {
  const now = Date.now();
  const sinceMs = now - windowMinutes * 60_000;
  const bucketWidthMs = (windowMinutes * 60_000) / buckets;
  const checks = listChecksForUrl(urlId, sinceMs);
  const points: SparklinePoint[] = [];
  for (let i = 0; i < buckets; i++) {
    const bucketStart = sinceMs + i * bucketWidthMs;
    const bucketEnd = bucketStart + bucketWidthMs;
    const inBucket = checks.filter((c) => c.checkedAt >= bucketStart && c.checkedAt < bucketEnd);
    const totals = inBucket.map((c) => c.timings.totalMs).filter((v): v is number => v != null);
    const avgLatencyMs =
      totals.length > 0 ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null;
    points.push({
      bucketStart,
      avgLatencyMs,
      failures: inBucket.filter((c) => !c.ok).length,
      total: inBucket.length,
    });
  }
  return points;
}
