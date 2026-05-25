import { randomUUID } from "node:crypto";
import { db, tx } from "./db.js";
import type {
  ApiKey,
  Assertion,
  AssertionResult,
  BodyType,
  CheckRecord,
  ExtractedValue,
  Extraction,
  Flow,
  FlowRun,
  FlowStats,
  FlowStep,
  FlowWithSteps,
  ForEachConfig,
  HttpMethod,
  KeyValue,
  MonitoredUrl,
  PrereqRun,
  PrereqStep,
  Project,
  ProjectVariable,
  SparklinePoint,
  StatusGroup,
  StepResult,
  Timings,
  Upload,
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
  prereq_interval_minutes: number;
  prereq_enabled: number;
  prereq_last_run_at: number | null;
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
  // Latest prereq run for at-a-glance status
  const lastRun = db()
    .prepare(
      "SELECT ok, total_ms FROM prereq_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 1"
    )
    .get(r.id) as { ok: number; total_ms: number | null } | undefined;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    slackWebhookUrl: r.slack_webhook_url,
    slackBotToken: r.slack_bot_token,
    slackChannel: r.slack_channel,
    apiKeys: keys.map(rowToApiKey),
    prereqIntervalMinutes: r.prereq_interval_minutes ?? 30,
    prereqEnabled: (r.prereq_enabled ?? 1) === 1,
    prereqLastRunAt: r.prereq_last_run_at,
    prereqLastRunOk: lastRun ? lastRun.ok === 1 : null,
    prereqLastRunTotalMs: lastRun?.total_ms ?? null,
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
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "description"
      | "slackWebhookUrl"
      | "slackBotToken"
      | "slackChannel"
      | "prereqIntervalMinutes"
      | "prereqEnabled"
    >
  >
): Project | undefined {
  const existing = getProject(id);
  if (!existing) return undefined;
  db()
    .prepare(
      `UPDATE projects
       SET name = ?, description = ?, slack_webhook_url = ?, slack_bot_token = ?, slack_channel = ?,
           prereq_interval_minutes = ?, prereq_enabled = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      patch.slackWebhookUrl ?? existing.slackWebhookUrl,
      patch.slackBotToken ?? existing.slackBotToken,
      patch.slackChannel ?? existing.slackChannel,
      Math.max(1, Math.min(60 * 24, Number(patch.prereqIntervalMinutes ?? existing.prereqIntervalMinutes))),
      (patch.prereqEnabled ?? existing.prereqEnabled) ? 1 : 0,
      id
    );
  return getProject(id);
}

export function markPrereqRunCompletedAt(projectId: string, when: number): void {
  db().prepare("UPDATE projects SET prereq_last_run_at = ? WHERE id = ?").run(when, projectId);
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
const ALLOWED_BODY_TYPES: BodyType[] = ["none", "json", "form", "urlencoded", "raw", "binary"];

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

// =============================================================
// FLOWS
// =============================================================

interface FlowRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  interval_minutes: number;
  stop_on_failure: number;
  enabled: number;
  last_run_at: number | null;
  created_at: string;
}

interface FlowStepRow {
  id: string;
  flow_id: string;
  position: number;
  description: string;
  url: string;
  method: string;
  body_type: string;
  body: string;
  body_content_type: string;
  api_key_id: string | null;
  assertions_json: string;
  custom_headers_json: string;
  query_params_json: string;
  extractions_json: string;
  wait_before_ms: number;
  max_retries: number;
  retry_backoff_ms: number;
  for_each_config_json: string | null;
}

interface FlowRunRow {
  id: string;
  flow_id: string;
  started_at: number;
  ended_at: number | null;
  ok: number;
  failed_at_step_id: string | null;
  variables_json: string;
  total_ms: number | null;
}

interface StepResultRow {
  id: string;
  flow_run_id: string;
  step_id: string;
  position: number;
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
  extracted_values_json: string;
  attempts: number;
  skipped: number;
  skip_reason: string | null;
  ok: number;
  checked_at: number;
  iteration_index: number | null;
  iteration_count: number | null;
  iteration_path_json: string | null;
  iteration_path_count_json: string | null;
  resolved_url: string | null;
}

function rowToFlow(r: FlowRow & { last_run_ok?: number | null; last_run_total_ms?: number | null }): Flow {
  const okRaw = (r as any).last_run_ok;
  const totalRaw = (r as any).last_run_total_ms;
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    intervalMinutes: r.interval_minutes,
    stopOnFailure: r.stop_on_failure === 1,
    enabled: r.enabled === 1,
    lastRunAt: r.last_run_at,
    lastRunOk: okRaw == null ? null : okRaw === 1,
    lastRunTotalMs: totalRaw == null ? null : Number(totalRaw),
    createdAt: r.created_at,
  };
}

function rowToFlowStep(r: FlowStepRow): FlowStep {
  return {
    id: r.id,
    flowId: r.flow_id,
    position: r.position,
    description: r.description,
    url: r.url,
    method: (r.method as HttpMethod) ?? "GET",
    bodyType: (r.body_type as BodyType) ?? "none",
    body: r.body ?? "",
    bodyContentType: r.body_content_type ?? "",
    apiKeyId: r.api_key_id,
    assertions: safeParse<Assertion[]>(r.assertions_json, []),
    customHeaders: safeParse<KeyValue[]>(r.custom_headers_json, []),
    queryParams: safeParse<KeyValue[]>(r.query_params_json, []),
    extractions: safeParse<Extraction[]>(r.extractions_json, []),
    waitBeforeMs: r.wait_before_ms,
    maxRetries: r.max_retries,
    retryBackoffMs: r.retry_backoff_ms,
    forEach: r.for_each_config_json ? safeParse<ForEachConfig | null>(r.for_each_config_json, null) : null,
  };
}

function rowToFlowRun(r: FlowRunRow, stepResults: StepResult[]): FlowRun {
  return {
    id: r.id,
    flowId: r.flow_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    ok: r.ok === 1,
    failedAtStepId: r.failed_at_step_id,
    totalMs: r.total_ms,
    variables: safeParse<Record<string, string>>(r.variables_json, {}),
    stepResults,
  };
}

function rowToStepResult(r: StepResultRow): StepResult {
  return {
    id: r.id,
    flowRunId: r.flow_run_id,
    stepId: r.step_id,
    position: r.position,
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
    extractedValues: safeParse<ExtractedValue[]>(r.extracted_values_json, []),
    attempts: r.attempts,
    skipped: r.skipped === 1,
    skipReason: r.skip_reason,
    ok: r.ok === 1,
    checkedAt: r.checked_at,
    iterationIndex: r.iteration_index,
    iterationCount: r.iteration_count,
    iterationPath: r.iteration_path_json
      ? safeParse<number[] | null>(r.iteration_path_json, null)
      : null,
    iterationPathCount: r.iteration_path_count_json
      ? safeParse<number[] | null>(r.iteration_path_count_json, null)
      : null,
    resolvedUrl: r.resolved_url,
  };
}

// ---- Flow CRUD ----

// Selects flow row plus a correlated subquery for the latest run's ok + duration.
// Used by all "list flows" calls so the frontend always knows last-run status.
const FLOW_SELECT_WITH_RUN = `
  SELECT f.*,
         (SELECT ok       FROM flow_runs WHERE flow_id = f.id ORDER BY started_at DESC LIMIT 1) AS last_run_ok,
         (SELECT total_ms FROM flow_runs WHERE flow_id = f.id ORDER BY started_at DESC LIMIT 1) AS last_run_total_ms
  FROM flows f
`;

export function listFlows(): Flow[] {
  const rows = db()
    .prepare(`${FLOW_SELECT_WITH_RUN} ORDER BY f.created_at`)
    .all() as unknown as FlowRow[];
  return rows.map(rowToFlow);
}

export function listFlowsByProject(projectId: string): Flow[] {
  const rows = db()
    .prepare(`${FLOW_SELECT_WITH_RUN} WHERE f.project_id = ? ORDER BY f.created_at`)
    .all(projectId) as unknown as FlowRow[];
  return rows.map(rowToFlow);
}

export function getFlow(id: string): Flow | undefined {
  const row = db()
    .prepare(`${FLOW_SELECT_WITH_RUN} WHERE f.id = ?`)
    .get(id) as unknown as FlowRow | undefined;
  return row ? rowToFlow(row) : undefined;
}

export function getFlowWithSteps(id: string): FlowWithSteps | undefined {
  const flow = getFlow(id);
  if (!flow) return undefined;
  return { ...flow, steps: listFlowSteps(id) };
}

export function createFlow(input: {
  projectId: string;
  name: string;
  description?: string;
  intervalMinutes?: number;
  stopOnFailure?: boolean;
  enabled?: boolean;
}): Flow {
  if (!getProject(input.projectId)) throw new Error("Project not found");
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO flows (id, project_id, name, description, interval_minutes, stop_on_failure, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.name.trim() || "Untitled flow",
      input.description?.trim() ?? "",
      Math.max(1, Math.min(60 * 24, Number(input.intervalMinutes ?? 5))),
      input.stopOnFailure !== false ? 1 : 0,
      input.enabled !== false ? 1 : 0,
      new Date().toISOString()
    );
  return getFlow(id)!;
}

export function updateFlow(
  id: string,
  patch: Partial<Pick<Flow, "name" | "description" | "intervalMinutes" | "stopOnFailure" | "enabled">>
): Flow | undefined {
  const existing = getFlow(id);
  if (!existing) return undefined;
  db()
    .prepare(
      `UPDATE flows
       SET name = ?, description = ?, interval_minutes = ?, stop_on_failure = ?, enabled = ?
       WHERE id = ?`
    )
    .run(
      patch.name?.trim() ?? existing.name,
      patch.description?.trim() ?? existing.description,
      Math.max(1, Math.min(60 * 24, Number(patch.intervalMinutes ?? existing.intervalMinutes))),
      (patch.stopOnFailure ?? existing.stopOnFailure) ? 1 : 0,
      (patch.enabled ?? existing.enabled) ? 1 : 0,
      id
    );
  return getFlow(id);
}

export function deleteFlow(id: string): boolean {
  const result = db().prepare("DELETE FROM flows WHERE id = ?").run(id);
  return result.changes > 0;
}

export function markFlowRunCompletedAt(id: string, when: number): void {
  db().prepare("UPDATE flows SET last_run_at = ? WHERE id = ?").run(when, id);
}

// ---- Step CRUD ----

export function listFlowSteps(flowId: string): FlowStep[] {
  const rows = db()
    .prepare("SELECT * FROM flow_steps WHERE flow_id = ? ORDER BY position")
    .all(flowId) as unknown as FlowStepRow[];
  return rows.map(rowToFlowStep);
}

export function getFlowStep(id: string): FlowStep | undefined {
  const row = db().prepare("SELECT * FROM flow_steps WHERE id = ?").get(id) as unknown as
    | FlowStepRow
    | undefined;
  return row ? rowToFlowStep(row) : undefined;
}

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** Phase 1.19 — `arrayVarName` may now be a dotted path against an outer-loop item. */
const DOTTED_PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

/** Phase 1.19 — max nested for-each depth in a single flow. */
const FOR_EACH_MAX_DEPTH = 4;

/**
 * Phase 1.18 / 1.19: normalize+validate a ForEachConfig payload, or return null.
 * Throws on partial/invalid input so the user gets immediate API feedback.
 * `arrayVarName` may now be a dotted path (Phase 1.19) like `student.subjects`.
 */
function normalizeForEach(raw: unknown): ForEachConfig | null {
  if (raw == null) return null;
  if (typeof raw !== "object") throw new Error("forEach must be an object");
  const arrayVarName = String((raw as any).arrayVarName ?? "").trim();
  const itemVarName = String((raw as any).itemVarName ?? "").trim();
  if (!arrayVarName && !itemVarName) return null;
  if (!DOTTED_PATH_RE.test(arrayVarName)) {
    throw new Error("forEach.arrayVarName must be a variable name or dotted path (e.g. 'students' or 'student.subjects')");
  }
  if (!IDENT_RE.test(itemVarName)) {
    throw new Error("forEach.itemVarName must be a valid identifier");
  }
  return { arrayVarName, itemVarName };
}

/**
 * Load the (id, position, forEach) tuples for every step in a flow. Used by
 * assertForEachDepth to validate a proposed change without re-fetching the
 * full FlowStep rows.
 */
function loadStepsForDepthCheck(
  flowId: string
): Array<{ id: string; position: number; forEach: ForEachConfig | null }> {
  const rows = db()
    .prepare(
      "SELECT id, position, for_each_config_json FROM flow_steps WHERE flow_id = ? ORDER BY position"
    )
    .all(flowId) as Array<{
      id: string;
      position: number;
      for_each_config_json: string | null;
    }>;
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    forEach: r.for_each_config_json
      ? (safeParse<ForEachConfig | null>(r.for_each_config_json, null))
      : null,
  }));
}

/**
 * Phase 1.19 — nesting depth guard. Replaces 1.18's `assertSingleForEach`.
 *
 * Walks the proposed (post-edit) list of steps in position order, maintaining a
 * "scope stack" of for-each item names. For each for-each step:
 *   - If `arrayVarName.split('.')[0]` is bound by the stack: this step is nested
 *     inside that scope. Truncate stack to that depth, then push this step's item.
 *   - Otherwise: this step starts a fresh top-level loop. Reset stack.
 * A non-iterating step breaks the chain (stack resets).
 * Throws if at any point the stack would exceed FOR_EACH_MAX_DEPTH (4).
 */
function assertForEachDepth(
  steps: Array<{ id: string; position: number; forEach: ForEachConfig | null }>
): void {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  let stack: string[] = [];
  for (const s of sorted) {
    if (!s.forEach) {
      stack = [];
      continue;
    }
    const root = s.forEach.arrayVarName.split(".")[0];
    const matchIdx = stack.indexOf(root);
    if (matchIdx >= 0) {
      stack = stack.slice(0, matchIdx + 1);
      stack.push(s.forEach.itemVarName);
    } else {
      stack = [s.forEach.itemVarName];
    }
    if (stack.length > FOR_EACH_MAX_DEPTH) {
      throw new Error(
        `for-each depth cannot exceed ${FOR_EACH_MAX_DEPTH} (got ${stack.length})`
      );
    }
  }
}

export function addFlowStep(input: {
  flowId: string;
  url: string;
  description?: string;
  method?: HttpMethod;
  bodyType?: BodyType;
  body?: string;
  bodyContentType?: string;
  apiKeyId?: string | null;
  assertions?: Assertion[];
  customHeaders?: KeyValue[];
  queryParams?: KeyValue[];
  extractions?: Extraction[];
  waitBeforeMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  forEach?: ForEachConfig | null;
}): FlowStep {
  const flow = getFlow(input.flowId);
  if (!flow) throw new Error("Flow not found");

  const url = input.url.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http(s) URLs are supported");
    }
  } catch {
    throw new Error("Invalid URL");
  }
  if ((input.method as string) === "DELETE") {
    throw new Error("DELETE method is not allowed for safety");
  }

  const forEach = normalizeForEach(input.forEach);

  // Next position = current max + 1
  const maxRow = db()
    .prepare("SELECT MAX(position) AS m FROM flow_steps WHERE flow_id = ?")
    .get(input.flowId) as { m: number | null };
  const nextPos = (maxRow.m ?? 0) + 1;

  // Phase 1.19 — validate nesting depth on the proposed post-add step list
  if (forEach) {
    const proposed = loadStepsForDepthCheck(input.flowId);
    proposed.push({ id: "__new__", position: nextPos, forEach });
    assertForEachDepth(proposed);
  }

  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO flow_steps (id, flow_id, position, description, url, method, body_type, body, body_content_type,
                               api_key_id, assertions_json, custom_headers_json, query_params_json,
                               extractions_json, wait_before_ms, max_retries, retry_backoff_ms, for_each_config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.flowId,
      nextPos,
      input.description?.trim() ?? "",
      url,
      input.method ?? "GET",
      input.bodyType ?? "none",
      input.body ?? "",
      input.bodyContentType?.trim() ?? "",
      input.apiKeyId ?? null,
      JSON.stringify(input.assertions ?? []),
      JSON.stringify(cleanKv(input.customHeaders ?? [])),
      JSON.stringify(cleanKv(input.queryParams ?? [])),
      JSON.stringify(input.extractions ?? []),
      Math.max(0, Math.min(60_000, Number(input.waitBeforeMs ?? 0))),
      Math.max(0, Math.min(5, Number(input.maxRetries ?? 0))),
      Math.max(100, Math.min(30_000, Number(input.retryBackoffMs ?? 1000))),
      forEach ? JSON.stringify(forEach) : null
    );
  return getFlowStep(id)!;
}

export function updateFlowStep(
  id: string,
  patch: Partial<{
    description: string;
    url: string;
    method: HttpMethod;
    bodyType: BodyType;
    body: string;
    bodyContentType: string;
    apiKeyId: string | null;
    assertions: Assertion[];
    customHeaders: KeyValue[];
    queryParams: KeyValue[];
    extractions: Extraction[];
    waitBeforeMs: number;
    maxRetries: number;
    retryBackoffMs: number;
    forEach: ForEachConfig | null;
  }>
): FlowStep | undefined {
  const existing = getFlowStep(id);
  if (!existing) return undefined;
  if ((patch.method as string) === "DELETE") {
    throw new Error("DELETE method is not allowed for safety");
  }

  // forEach: if the caller passed the key, use the normalized value (which may be null
  // to clear it). If the key was not in the patch, keep what's already stored.
  const forEachProvided = Object.prototype.hasOwnProperty.call(patch, "forEach");
  const nextForEach = forEachProvided
    ? normalizeForEach(patch.forEach)
    : existing.forEach ?? null;

  // Phase 1.19 — validate nesting depth on the proposed post-update step list
  if (forEachProvided) {
    const proposed = loadStepsForDepthCheck(existing.flowId);
    const idx = proposed.findIndex((s) => s.id === id);
    if (idx >= 0) proposed[idx] = { ...proposed[idx], forEach: nextForEach };
    assertForEachDepth(proposed);
  }

  db()
    .prepare(
      `UPDATE flow_steps
       SET description = ?, url = ?, method = ?, body_type = ?, body = ?, body_content_type = ?,
           api_key_id = ?, assertions_json = ?, custom_headers_json = ?, query_params_json = ?,
           extractions_json = ?, wait_before_ms = ?, max_retries = ?, retry_backoff_ms = ?,
           for_each_config_json = ?
       WHERE id = ?`
    )
    .run(
      patch.description ?? existing.description,
      patch.url ?? existing.url,
      patch.method ?? existing.method,
      patch.bodyType ?? existing.bodyType,
      patch.body ?? existing.body,
      patch.bodyContentType ?? existing.bodyContentType,
      patch.apiKeyId !== undefined ? patch.apiKeyId : existing.apiKeyId,
      JSON.stringify(patch.assertions ?? existing.assertions),
      JSON.stringify(cleanKv(patch.customHeaders ?? existing.customHeaders)),
      JSON.stringify(cleanKv(patch.queryParams ?? existing.queryParams)),
      JSON.stringify(patch.extractions ?? existing.extractions),
      Math.max(0, Math.min(60_000, Number(patch.waitBeforeMs ?? existing.waitBeforeMs))),
      Math.max(0, Math.min(5, Number(patch.maxRetries ?? existing.maxRetries))),
      Math.max(100, Math.min(30_000, Number(patch.retryBackoffMs ?? existing.retryBackoffMs))),
      nextForEach ? JSON.stringify(nextForEach) : null,
      id
    );
  return getFlowStep(id);
}

export function deleteFlowStep(id: string): boolean {
  const existing = getFlowStep(id);
  if (!existing) return false;
  tx(() => {
    db().prepare("DELETE FROM flow_steps WHERE id = ?").run(id);
    db()
      .prepare("UPDATE flow_steps SET position = position - 1 WHERE flow_id = ? AND position > ?")
      .run(existing.flowId, existing.position);
  });
  return true;
}

export function reorderFlowSteps(flowId: string, orderedIds: string[]): void {
  tx(() => {
    orderedIds.forEach((stepId, idx) => {
      db()
        .prepare("UPDATE flow_steps SET position = ? WHERE id = ? AND flow_id = ?")
        .run(idx + 1, stepId, flowId);
    });
  });
}

/**
 * Insert a fresh copy of `source` at position 1 of `targetFlowId`. Shifts the
 * target flow's existing steps down by one (position += 1) inside a single tx
 * so the (flowId, position) sequence stays contiguous.
 */
function insertStepCopyAtTop(targetFlowId: string, source: FlowStep): FlowStep {
  const newId = randomUUID();
  tx(() => {
    db()
      .prepare("UPDATE flow_steps SET position = position + 1 WHERE flow_id = ?")
      .run(targetFlowId);
    db()
      .prepare(
        `INSERT INTO flow_steps (id, flow_id, position, description, url, method, body_type, body, body_content_type,
                                 api_key_id, assertions_json, custom_headers_json, query_params_json,
                                 extractions_json, wait_before_ms, max_retries, retry_backoff_ms, for_each_config_json)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId,
        targetFlowId,
        source.description,
        source.url,
        source.method,
        source.bodyType,
        source.body,
        source.bodyContentType,
        source.apiKeyId,
        JSON.stringify(source.assertions),
        JSON.stringify(source.customHeaders),
        JSON.stringify(source.queryParams),
        JSON.stringify(source.extractions),
        source.waitBeforeMs,
        source.maxRetries,
        source.retryBackoffMs,
        source.forEach ? JSON.stringify(source.forEach) : null
      );
  });
  return getFlowStep(newId)!;
}

export function copyFlowStepToFlow(stepId: string, targetFlowId: string): FlowStep {
  const source = getFlowStep(stepId);
  if (!source) throw new Error("Source step not found");
  const target = getFlow(targetFlowId);
  if (!target) throw new Error("Target flow not found");
  // Phase 1.19: validate nesting depth after the source is inserted at position 1
  if (source.forEach) {
    const proposed = loadStepsForDepthCheck(targetFlowId).map((s) => ({
      ...s,
      position: s.position + 1,
    }));
    proposed.unshift({ id: "__new__", position: 1, forEach: source.forEach });
    assertForEachDepth(proposed);
  }
  return insertStepCopyAtTop(targetFlowId, source);
}

export function moveFlowStepToFlow(stepId: string, targetFlowId: string): FlowStep {
  const source = getFlowStep(stepId);
  if (!source) throw new Error("Source step not found");
  if (source.flowId === targetFlowId) {
    throw new Error("Source and target flow are the same");
  }
  const target = getFlow(targetFlowId);
  if (!target) throw new Error("Target flow not found");
  // Phase 1.19: validate nesting depth after the source is inserted at position 1
  if (source.forEach) {
    const proposed = loadStepsForDepthCheck(targetFlowId).map((s) => ({
      ...s,
      position: s.position + 1,
    }));
    proposed.unshift({ id: "__new__", position: 1, forEach: source.forEach });
    assertForEachDepth(proposed);
  }

  const sourceFlowId = source.flowId;
  const sourcePosition = source.position;
  let newId = "";
  tx(() => {
    // Shift target down and insert the copy at position 1
    db()
      .prepare("UPDATE flow_steps SET position = position + 1 WHERE flow_id = ?")
      .run(targetFlowId);
    newId = randomUUID();
    db()
      .prepare(
        `INSERT INTO flow_steps (id, flow_id, position, description, url, method, body_type, body, body_content_type,
                                 api_key_id, assertions_json, custom_headers_json, query_params_json,
                                 extractions_json, wait_before_ms, max_retries, retry_backoff_ms, for_each_config_json)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId,
        targetFlowId,
        source.description,
        source.url,
        source.method,
        source.bodyType,
        source.body,
        source.bodyContentType,
        source.apiKeyId,
        JSON.stringify(source.assertions),
        JSON.stringify(source.customHeaders),
        JSON.stringify(source.queryParams),
        JSON.stringify(source.extractions),
        source.waitBeforeMs,
        source.maxRetries,
        source.retryBackoffMs,
        source.forEach ? JSON.stringify(source.forEach) : null
      );
    // Delete source + rebalance source flow so positions stay contiguous
    db().prepare("DELETE FROM flow_steps WHERE id = ?").run(stepId);
    db()
      .prepare(
        "UPDATE flow_steps SET position = position - 1 WHERE flow_id = ? AND position > ?"
      )
      .run(sourceFlowId, sourcePosition);
  });
  return getFlowStep(newId)!;
}

// ---- Flow Runs ----

export function startFlowRun(flowId: string): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO flow_runs (id, flow_id, started_at, ended_at, ok, failed_at_step_id, variables_json, total_ms)
       VALUES (?, ?, ?, NULL, 0, NULL, '{}', NULL)`
    )
    .run(id, flowId, Date.now());
  return id;
}

export function finishFlowRun(args: {
  id: string;
  ok: boolean;
  failedAtStepId: string | null;
  variables: Record<string, string>;
  totalMs: number;
}): void {
  const endedAt = Date.now();
  db()
    .prepare(
      `UPDATE flow_runs
       SET ended_at = ?, ok = ?, failed_at_step_id = ?, variables_json = ?, total_ms = ?
       WHERE id = ?`
    )
    .run(
      endedAt,
      args.ok ? 1 : 0,
      args.failedAtStepId,
      JSON.stringify(args.variables),
      args.totalMs,
      args.id
    );
}

export function recordStepResult(args: {
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
  iterationIndex?: number | null;
  iterationCount?: number | null;
  /** Phase 1.19 — nested iteration path (0-indexed). NULL for flat or non-iterating rows. */
  iterationPath?: number[] | null;
  /** Phase 1.19 — per-level totals matching iterationPath. */
  iterationPathCount?: number[] | null;
  /** Phase 1.19.1 — URL actually fetched after {{var}} substitution. NULL if no fetch happened. */
  resolvedUrl?: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO step_results (id, flow_run_id, step_id, position, status_code, status_group, error_reason,
                                  dns_ms, tcp_ms, tls_ms, ttfb_ms, download_ms, total_ms,
                                  assertion_results_json, extracted_values_json, attempts, skipped, skip_reason,
                                  ok, checked_at, iteration_index, iteration_count,
                                  iteration_path_json, iteration_path_count_json, resolved_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      args.flowRunId,
      args.stepId,
      args.position,
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
      JSON.stringify(args.extractedValues),
      args.attempts,
      args.skipped ? 1 : 0,
      args.skipReason,
      args.ok ? 1 : 0,
      Date.now(),
      args.iterationIndex ?? null,
      args.iterationCount ?? null,
      args.iterationPath ? JSON.stringify(args.iterationPath) : null,
      args.iterationPathCount ? JSON.stringify(args.iterationPathCount) : null,
      args.resolvedUrl ?? null
    );
}

export function getFlowRun(id: string): FlowRun | undefined {
  const row = db().prepare("SELECT * FROM flow_runs WHERE id = ?").get(id) as unknown as
    | FlowRunRow
    | undefined;
  if (!row) return undefined;
  const stepRows = db()
    .prepare("SELECT * FROM step_results WHERE flow_run_id = ? ORDER BY position")
    .all(id) as unknown as StepResultRow[];
  return rowToFlowRun(row, stepRows.map(rowToStepResult));
}

export function listFlowRuns(flowId: string, limit = 30): FlowRun[] {
  const rows = db()
    .prepare("SELECT * FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(flowId, limit) as unknown as FlowRunRow[];
  return rows.map((r) => {
    const stepRows = db()
      .prepare("SELECT * FROM step_results WHERE flow_run_id = ? ORDER BY position")
      .all(r.id) as unknown as StepResultRow[];
    return rowToFlowRun(r, stepRows.map(rowToStepResult));
  });
}

export function getFlowStats(flowId: string, windowMinutes: number): FlowStats {
  const sinceMs = Date.now() - windowMinutes * 60_000;
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
              AVG(total_ms) AS avg_total
       FROM flow_runs
       WHERE flow_id = ? AND started_at >= ? AND ended_at IS NOT NULL`
    )
    .get(flowId, sinceMs) as { total: number; failed: number | null; avg_total: number | null };
  const total = Number(row.total ?? 0);
  const failed = Number(row.failed ?? 0);
  return {
    flowId,
    windowMinutes,
    totalRuns: total,
    failedRuns: failed,
    failureRatePct: total > 0 ? Number(((failed / total) * 100).toFixed(2)) : 0,
    avgTotalMs: row.avg_total != null ? Math.round(Number(row.avg_total)) : null,
  };
}

// ---- Variable cache (smart caching with TTL) ----

export function getCachedVariables(flowId: string): Record<string, string> {
  const now = Date.now();
  const rows = db()
    .prepare(
      "SELECT variable_name, value FROM variable_cache WHERE flow_id = ? AND expires_at > ?"
    )
    .all(flowId, now) as { variable_name: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.variable_name] = r.value;
  return out;
}

export function cacheVariable(flowId: string, name: string, value: string, ttlSeconds: number): void {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO variable_cache (flow_id, variable_name, value, captured_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(flow_id, variable_name) DO UPDATE SET
         value = excluded.value,
         captured_at = excluded.captured_at,
         expires_at = excluded.expires_at`
    )
    .run(flowId, name, value, now, now + ttlSeconds * 1000);
}

export function clearVariableCache(flowId: string): void {
  db().prepare("DELETE FROM variable_cache WHERE flow_id = ?").run(flowId);
}

// =============================================================
// PREREQUISITES (project-level setup chain)
// =============================================================

interface PrereqStepRow {
  id: string;
  project_id: string;
  position: number;
  description: string;
  url: string;
  method: string;
  body_type: string;
  body: string;
  body_content_type: string;
  api_key_id: string | null;
  assertions_json: string;
  custom_headers_json: string;
  query_params_json: string;
  extractions_json: string;
  wait_before_ms: number;
  max_retries: number;
  retry_backoff_ms: number;
}

interface PrereqRunRow {
  id: string;
  project_id: string;
  started_at: number;
  ended_at: number | null;
  ok: number;
  failed_at_step_id: string | null;
  variables_json: string;
  total_ms: number | null;
}

interface PrereqStepResultRow {
  id: string;
  prereq_run_id: string;
  step_id: string;
  position: number;
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
  extracted_values_json: string;
  attempts: number;
  skipped: number;
  skip_reason: string | null;
  ok: number;
  checked_at: number;
  resolved_url: string | null;
}

function rowToPrereqStep(r: PrereqStepRow): PrereqStep {
  return {
    id: r.id,
    projectId: r.project_id,
    position: r.position,
    description: r.description,
    url: r.url,
    method: (r.method as HttpMethod) ?? "GET",
    bodyType: (r.body_type as BodyType) ?? "none",
    body: r.body ?? "",
    bodyContentType: r.body_content_type ?? "",
    apiKeyId: r.api_key_id,
    assertions: safeParse<Assertion[]>(r.assertions_json, []),
    customHeaders: safeParse<KeyValue[]>(r.custom_headers_json, []),
    queryParams: safeParse<KeyValue[]>(r.query_params_json, []),
    extractions: safeParse<Extraction[]>(r.extractions_json, []),
    waitBeforeMs: r.wait_before_ms,
    maxRetries: r.max_retries,
    retryBackoffMs: r.retry_backoff_ms,
  };
}

function rowToPrereqStepResult(r: PrereqStepResultRow): StepResult {
  return {
    id: r.id,
    flowRunId: r.prereq_run_id,
    stepId: r.step_id,
    position: r.position,
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
    extractedValues: safeParse<ExtractedValue[]>(r.extracted_values_json, []),
    attempts: r.attempts,
    skipped: r.skipped === 1,
    skipReason: r.skip_reason,
    ok: r.ok === 1,
    checkedAt: r.checked_at,
    // Prereq steps never iterate (for-each is a flow-only feature).
    iterationIndex: null,
    iterationCount: null,
    iterationPath: null,
    iterationPathCount: null,
    resolvedUrl: r.resolved_url,
  };
}

function rowToPrereqRun(r: PrereqRunRow, stepResults: StepResult[]): PrereqRun {
  return {
    id: r.id,
    projectId: r.project_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    ok: r.ok === 1,
    failedAtStepId: r.failed_at_step_id,
    totalMs: r.total_ms,
    variables: safeParse<Record<string, string>>(r.variables_json, {}),
    stepResults,
  };
}

// ---- Prereq step CRUD ----

export function listPrereqSteps(projectId: string): PrereqStep[] {
  const rows = db()
    .prepare("SELECT * FROM prereq_steps WHERE project_id = ? ORDER BY position")
    .all(projectId) as unknown as PrereqStepRow[];
  return rows.map(rowToPrereqStep);
}

export function getPrereqStep(id: string): PrereqStep | undefined {
  const row = db().prepare("SELECT * FROM prereq_steps WHERE id = ?").get(id) as unknown as
    | PrereqStepRow
    | undefined;
  return row ? rowToPrereqStep(row) : undefined;
}

export function addPrereqStep(input: {
  projectId: string;
  url: string;
  description?: string;
  method?: HttpMethod;
  bodyType?: BodyType;
  body?: string;
  bodyContentType?: string;
  apiKeyId?: string | null;
  assertions?: Assertion[];
  customHeaders?: KeyValue[];
  queryParams?: KeyValue[];
  extractions?: Extraction[];
  waitBeforeMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
}): PrereqStep {
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
  if ((input.method as string) === "DELETE") {
    throw new Error("DELETE method is not allowed for safety");
  }

  const maxRow = db()
    .prepare("SELECT MAX(position) AS m FROM prereq_steps WHERE project_id = ?")
    .get(input.projectId) as { m: number | null };
  const nextPos = (maxRow.m ?? 0) + 1;

  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO prereq_steps (id, project_id, position, description, url, method, body_type, body,
                                 body_content_type, api_key_id, assertions_json, custom_headers_json,
                                 query_params_json, extractions_json, wait_before_ms, max_retries, retry_backoff_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      nextPos,
      input.description?.trim() ?? "",
      url,
      input.method ?? "GET",
      input.bodyType ?? "none",
      input.body ?? "",
      input.bodyContentType?.trim() ?? "",
      input.apiKeyId ?? null,
      JSON.stringify(input.assertions ?? []),
      JSON.stringify(cleanKv(input.customHeaders ?? [])),
      JSON.stringify(cleanKv(input.queryParams ?? [])),
      JSON.stringify(input.extractions ?? []),
      Math.max(0, Math.min(60_000, Number(input.waitBeforeMs ?? 0))),
      Math.max(0, Math.min(5, Number(input.maxRetries ?? 0))),
      Math.max(100, Math.min(30_000, Number(input.retryBackoffMs ?? 1000)))
    );
  return getPrereqStep(id)!;
}

export function updatePrereqStep(
  id: string,
  patch: Partial<{
    description: string;
    url: string;
    method: HttpMethod;
    bodyType: BodyType;
    body: string;
    bodyContentType: string;
    apiKeyId: string | null;
    assertions: Assertion[];
    customHeaders: KeyValue[];
    queryParams: KeyValue[];
    extractions: Extraction[];
    waitBeforeMs: number;
    maxRetries: number;
    retryBackoffMs: number;
  }>
): PrereqStep | undefined {
  const existing = getPrereqStep(id);
  if (!existing) return undefined;
  if ((patch.method as string) === "DELETE") {
    throw new Error("DELETE method is not allowed for safety");
  }
  db()
    .prepare(
      `UPDATE prereq_steps
       SET description = ?, url = ?, method = ?, body_type = ?, body = ?, body_content_type = ?,
           api_key_id = ?, assertions_json = ?, custom_headers_json = ?, query_params_json = ?,
           extractions_json = ?, wait_before_ms = ?, max_retries = ?, retry_backoff_ms = ?
       WHERE id = ?`
    )
    .run(
      patch.description ?? existing.description,
      patch.url ?? existing.url,
      patch.method ?? existing.method,
      patch.bodyType ?? existing.bodyType,
      patch.body ?? existing.body,
      patch.bodyContentType ?? existing.bodyContentType,
      patch.apiKeyId !== undefined ? patch.apiKeyId : existing.apiKeyId,
      JSON.stringify(patch.assertions ?? existing.assertions),
      JSON.stringify(cleanKv(patch.customHeaders ?? existing.customHeaders)),
      JSON.stringify(cleanKv(patch.queryParams ?? existing.queryParams)),
      JSON.stringify(patch.extractions ?? existing.extractions),
      Math.max(0, Math.min(60_000, Number(patch.waitBeforeMs ?? existing.waitBeforeMs))),
      Math.max(0, Math.min(5, Number(patch.maxRetries ?? existing.maxRetries))),
      Math.max(100, Math.min(30_000, Number(patch.retryBackoffMs ?? existing.retryBackoffMs))),
      id
    );
  return getPrereqStep(id);
}

export function deletePrereqStep(id: string): boolean {
  const existing = getPrereqStep(id);
  if (!existing) return false;
  tx(() => {
    db().prepare("DELETE FROM prereq_steps WHERE id = ?").run(id);
    db()
      .prepare("UPDATE prereq_steps SET position = position - 1 WHERE project_id = ? AND position > ?")
      .run(existing.projectId, existing.position);
  });
  return true;
}

export function reorderPrereqSteps(projectId: string, orderedIds: string[]): void {
  tx(() => {
    orderedIds.forEach((stepId, idx) => {
      db()
        .prepare("UPDATE prereq_steps SET position = ? WHERE id = ? AND project_id = ?")
        .run(idx + 1, stepId, projectId);
    });
  });
}

// ---- Prereq runs ----

export function startPrereqRun(projectId: string): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO prereq_runs (id, project_id, started_at, ended_at, ok, failed_at_step_id, variables_json, total_ms)
       VALUES (?, ?, ?, NULL, 0, NULL, '{}', NULL)`
    )
    .run(id, projectId, Date.now());
  return id;
}

export function finishPrereqRun(args: {
  id: string;
  ok: boolean;
  failedAtStepId: string | null;
  variables: Record<string, string>;
  totalMs: number;
}): void {
  db()
    .prepare(
      `UPDATE prereq_runs SET ended_at = ?, ok = ?, failed_at_step_id = ?, variables_json = ?, total_ms = ?
       WHERE id = ?`
    )
    .run(
      Date.now(),
      args.ok ? 1 : 0,
      args.failedAtStepId,
      JSON.stringify(args.variables),
      args.totalMs,
      args.id
    );
}

export function recordPrereqStepResult(args: {
  prereqRunId: string;
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
  /** Phase 1.19.1 — URL actually fetched after {{var}} substitution. NULL if no fetch happened. */
  resolvedUrl?: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO prereq_step_results (id, prereq_run_id, step_id, position, status_code, status_group, error_reason,
                                         dns_ms, tcp_ms, tls_ms, ttfb_ms, download_ms, total_ms,
                                         assertion_results_json, extracted_values_json, attempts, skipped, skip_reason,
                                         ok, checked_at, resolved_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      args.prereqRunId,
      args.stepId,
      args.position,
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
      JSON.stringify(args.extractedValues),
      args.attempts,
      args.skipped ? 1 : 0,
      args.skipReason,
      args.ok ? 1 : 0,
      Date.now(),
      args.resolvedUrl ?? null
    );
}

export function getPrereqRun(id: string): PrereqRun | undefined {
  const row = db().prepare("SELECT * FROM prereq_runs WHERE id = ?").get(id) as unknown as
    | PrereqRunRow
    | undefined;
  if (!row) return undefined;
  const stepRows = db()
    .prepare("SELECT * FROM prereq_step_results WHERE prereq_run_id = ? ORDER BY position")
    .all(id) as unknown as PrereqStepResultRow[];
  return rowToPrereqRun(row, stepRows.map(rowToPrereqStepResult));
}

export function listPrereqRuns(projectId: string, limit = 30): PrereqRun[] {
  const rows = db()
    .prepare("SELECT * FROM prereq_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(projectId, limit) as unknown as PrereqRunRow[];
  return rows.map((r) => {
    const stepRows = db()
      .prepare("SELECT * FROM prereq_step_results WHERE prereq_run_id = ? ORDER BY position")
      .all(r.id) as unknown as PrereqStepResultRow[];
    return rowToPrereqRun(r, stepRows.map(rowToPrereqStepResult));
  });
}

// ---- Project variable cache (consumed by URLs + flows) ----

export function getProjectVariables(projectId: string): Record<string, string> {
  const now = Date.now();
  const rows = db()
    .prepare(
      "SELECT variable_name, value FROM project_variable_cache WHERE project_id = ? AND expires_at > ?"
    )
    .all(projectId, now) as { variable_name: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.variable_name] = r.value;
  return out;
}

export function listProjectVariables(projectId: string): ProjectVariable[] {
  const rows = db()
    .prepare(
      "SELECT variable_name, value, captured_at, expires_at FROM project_variable_cache WHERE project_id = ? ORDER BY variable_name"
    )
    .all(projectId) as {
    variable_name: string;
    value: string;
    captured_at: number;
    expires_at: number;
  }[];
  return rows.map((r) => ({
    name: r.variable_name,
    value: r.value,
    capturedAt: r.captured_at,
    expiresAt: r.expires_at,
  }));
}

export function cacheProjectVariable(
  projectId: string,
  name: string,
  value: string,
  ttlSeconds: number
): void {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO project_variable_cache (project_id, variable_name, value, captured_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, variable_name) DO UPDATE SET
         value = excluded.value,
         captured_at = excluded.captured_at,
         expires_at = excluded.expires_at`
    )
    .run(projectId, name, value, now, now + ttlSeconds * 1000);
}

export function clearProjectVariableCache(projectId: string): void {
  db().prepare("DELETE FROM project_variable_cache WHERE project_id = ?").run(projectId);
}

// =============================================================
// UPLOADS (binary files referenced by steps with bodyType="binary")
// =============================================================

interface UploadRow {
  id: string;
  project_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
}

function rowToUpload(r: UploadRow): Upload {
  return {
    id: r.id,
    projectId: r.project_id,
    filename: r.filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
  };
}

export function createUpload(input: {
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Upload {
  if (!getProject(input.projectId)) throw new Error("Project not found");
  const id = randomUUID();
  const createdAt = Date.now();
  db()
    .prepare(
      `INSERT INTO uploads (id, project_id, filename, mime_type, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.projectId,
      input.filename.trim() || "upload",
      input.mimeType || "application/octet-stream",
      input.sizeBytes,
      createdAt
    );
  return { id, projectId: input.projectId, filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, createdAt };
}

export function getUpload(id: string): Upload | undefined {
  const row = db().prepare("SELECT * FROM uploads WHERE id = ?").get(id) as
    | UploadRow
    | undefined;
  return row ? rowToUpload(row) : undefined;
}

export function listUploadsByProject(projectId: string): Upload[] {
  const rows = db()
    .prepare("SELECT * FROM uploads WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as unknown as UploadRow[];
  return rows.map(rowToUpload);
}

export function deleteUpload(id: string): boolean {
  return db().prepare("DELETE FROM uploads WHERE id = ?").run(id).changes > 0;
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
