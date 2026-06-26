import { reasonForError, reasonForStatus } from "./errorReason.js";
import { sendSlackAlert } from "./slack.js";
import { classifyFailure, pickRecipients, pickSlackWebhook, sendUrlFailureEmail } from "./email.js";
import { evaluateAssertions } from "./assertions.js";
import {
  getProject,
  getProjectApiKeysScope,
  getProjectVariables,
  getUrl,
  listFlows,
  listProjects,
  listUrls,
  recordCheck,
  resolveApiKeyHeader,
} from "./store.js";
import { pruneOldChecks, pruneOldReports } from "./db.js";
import { resolve as resolvePath } from "node:path";
import { timedFetch } from "./timing.js";
import { runFlow } from "./flowRunner.js";
import { runPrereqChain } from "./prereqRunner.js";
import { substitute } from "./extraction.js";
import type { FullSnapshot, KeyValue, MonitoredUrl, StatusGroup } from "./types.js";

const TICK_MS = 30_000;
const PRUNE_MS = 60 * 60_000; // every hour

const inFlight = new Map<string, Promise<MonitoredUrl | undefined>>();

function classify(code: number): StatusGroup {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500 && code < 600) return "5xx";
  return "error";
}

function substituteKv(items: KeyValue[], vars: Record<string, string>): KeyValue[] {
  return items.map((it) => ({ key: it.key, value: substitute(it.value, vars) }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function doCheck(urlId: string): Promise<MonitoredUrl | undefined> {
  const url = getUrl(urlId);
  if (!url) return undefined;
  const project = getProject(url.projectId);
  // Must mirror the `ok` semantics below (status + assertions). Using statusGroup
  // alone misses 2xx responses that fail an assertion — wasFailing stays false and
  // the OK→FAIL gate re-fires every tick. First-ever check has no prior snapshot.
  const lastStatusOk = url.statusGroup === "2xx" || url.statusGroup === "3xx";
  const lastAssertionsOk = url.lastAssertionResults.every((r) => r.passed);
  const wasFailing = url.lastChecked != null && !(lastStatusOk && lastAssertionsOk);

  const headers: Record<string, string> = {};
  const auth = resolveApiKeyHeader(url);
  if (auth) headers[auth.name] = auth.value;

  // Resolve {{vars}}. Phase 1.27.4 — vault API keys are exposed as variables
  // (Postman-style) at the LOWEST priority so prereq-captured project vars can
  // override on name collision.
  const projectVars: Record<string, string> = {
    ...getProjectApiKeysScope(url.projectId),
    ...getProjectVariables(url.projectId),
  };

  const requestSpec = {
    url: substitute(url.url, projectVars),
    method: url.method,
    bodyType: url.bodyType,
    body: substitute(url.body, projectVars),
    bodyContentType: url.bodyContentType,
    extraHeaders: headers,
    customHeaders: substituteKv(url.customHeaders, projectVars),
    queryParams: substituteKv(url.queryParams, projectVars),
  };

  // Phase 1.27.3 — honor per-URL waitBeforeMs before the first attempt and
  // retry on failure up to maxRetries with exponential backoff. Only the
  // final attempt's outcome is recorded (no per-retry rows in `checks`).
  // Skip retries on 4xx — those are deterministic client errors.
  const waitBeforeMs = Math.max(0, Math.min(60_000, url.waitBeforeMs ?? 0));
  const maxAttempts = 1 + Math.max(0, Math.min(10, url.maxRetries ?? 0));
  const baseBackoff = Math.max(0, Math.min(60_000, url.retryBackoffMs ?? 0));

  if (waitBeforeMs > 0) await sleep(waitBeforeMs);

  let result!: Awaited<ReturnType<typeof timedFetch>>;
  let statusCode: number | null = null;
  let statusGroup: StatusGroup | null = null;
  let errorReason: string | null = null;
  let assertionResults: ReturnType<typeof evaluateAssertions> = [];
  let ok = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(baseBackoff * Math.pow(2, attempt - 1));

    result = await timedFetch(requestSpec);

    if (result.error) {
      statusCode = null;
      statusGroup = "error";
      errorReason = reasonForError(result.error);
    } else {
      const code = result.statusCode ?? 0;
      statusCode = code || null;
      statusGroup = code ? classify(code) : "error";
      const isFailure = statusGroup === "4xx" || statusGroup === "5xx" || statusGroup === "error";
      errorReason = isFailure ? reasonForStatus(code) : null;
    }

    assertionResults = evaluateAssertions(
      url.assertions,
      {
        statusCode,
        totalMs: result.timings.totalMs,
        responseBody: result.responseBody,
      },
      projectVars
    );
    const allAssertionsPassed = assertionResults.every((r) => r.passed);
    const statusOk = statusGroup === "2xx" || statusGroup === "3xx";
    ok = statusOk && allAssertionsPassed;

    // Stop retrying on success, or on a deterministic 4xx (client error).
    if (ok || statusGroup === "4xx") break;
  }

  const checkedAt = Date.now();

  // Surface the assertion detail when the response was a healthy 2xx/3xx but an
  // assertion failed — otherwise email/Slack render the literal "Unknown failure".
  if (errorReason == null && !ok) {
    const firstFailed = assertionResults.find((r) => !r.passed);
    if (firstFailed) errorReason = `Assertion failed: ${firstFailed.detail}`;
  }

  recordCheck({
    urlId: url.id,
    statusCode,
    statusGroup,
    errorReason,
    timings: result.timings,
    assertionResults,
    ok,
    checkedAt,
  });

  // Re-fetch the URL with the updated snapshot
  const updated = getUrl(url.id);
  if (!updated) return undefined;
  updated.lastAssertionResults = assertionResults;

  // Notifications: alert on transition into failing state. Slack + email fire
  // in parallel via Promise.allSettled so one channel's failure can't suppress
  // the other. Each sender has its own internal "is configured" gate.
  // Phase 1.27.2 — route latency-only failures to the dedicated recipient list;
  // mixed and non-latency failures go to the general list (also the fallback
  // when the latency list is empty).
  const isFailingNow = !ok;
  if (isFailingNow && !wasFailing && project) {
    const category = classifyFailure(assertionResults);
    const emailRecipients = pickRecipients(project, category);
    // Phase 1.27.13 — Slack webhook now picked by category, mirroring email.
    const slackWebhook = pickSlackWebhook(project, category);
    void Promise.allSettled([
      slackWebhook
        ? sendSlackAlert(slackWebhook, project, updated)
        : Promise.resolve(),
      sendUrlFailureEmail(project, updated, emailRecipients),
    ]);
  }

  return updated;
}

export function checkOne(urlId: string): Promise<MonitoredUrl | undefined> {
  const existing = inFlight.get(urlId);
  if (existing) return existing;
  const p = doCheck(urlId).finally(() => inFlight.delete(urlId));
  inFlight.set(urlId, p);
  return p;
}

export async function tick(): Promise<void> {
  const now = Date.now();

  // 1) Due prereq chains (run FIRST so URLs/flows have fresh tokens)
  const duePrereqProjectIds: string[] = [];
  for (const p of listProjects()) {
    if (!p.prereqEnabled) continue;
    const intervalMs = Math.max(60_000, p.prereqIntervalMinutes * 60_000);
    const last = p.prereqLastRunAt ?? 0;
    if (!last || now - last >= intervalMs) duePrereqProjectIds.push(p.id);
  }
  if (duePrereqProjectIds.length > 0) {
    await Promise.all(duePrereqProjectIds.map((id) => runPrereqChain(id)));
  }

  // 2) Due standalone URLs
  const dueUrls: MonitoredUrl[] = [];
  for (const u of listUrls()) {
    const intervalMs = Math.max(60_000, u.intervalMinutes * 60_000);
    const last = u.lastChecked ? Date.parse(u.lastChecked) : 0;
    if (!last || now - last >= intervalMs) dueUrls.push(u);
  }

  // 3) Due flows (whole flow runs atomically when its interval has elapsed)
  const dueFlowIds: string[] = [];
  for (const flow of listFlows()) {
    if (!flow.enabled) continue;
    const intervalMs = Math.max(60_000, flow.intervalMinutes * 60_000);
    const last = flow.lastRunAt ?? 0;
    if (!last || now - last >= intervalMs) dueFlowIds.push(flow.id);
  }

  await Promise.all([
    ...dueUrls.map((u) => checkOne(u.id)),
    ...dueFlowIds.map((id) => runFlow(id)),
  ]);
}

/**
 * Run all checks in a project in parallel (with a concurrency cap).
 * Used for the manual "Run Audit" / Check All trigger.
 */
export async function checkAllInProject(projectId: string, concurrency = 8): Promise<MonitoredUrl[]> {
  const urls = listUrls().filter((u) => u.projectId === projectId);
  const results: MonitoredUrl[] = [];
  const queue = [...urls];
  await Promise.all(
    Array(Math.min(concurrency, queue.length))
      .fill(0)
      .map(async () => {
        while (queue.length) {
          const next = queue.shift();
          if (!next) break;
          const u = await checkOne(next.id);
          if (u) results.push(u);
        }
      })
  );
  return results;
}

export function snapshot(): FullSnapshot {
  const urls = listUrls();
  const groups: Record<StatusGroup, number> = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    error: 0,
  };
  for (const u of urls) {
    if (u.statusGroup) groups[u.statusGroup]++;
  }
  return {
    projects: listProjects(),
    urls,
    groups,
    total: urls.length,
    lastUpdated: new Date().toISOString(),
  };
}

export function startMonitorLoop(): void {
  void tick();
  setInterval(() => void tick(), TICK_MS);
  pruneOldChecks();
  setInterval(() => pruneOldChecks(), PRUNE_MS);
  // Phase 1.27.9 — also sweep the audit-report HTML directory.
  const reportsDir = resolvePath("./data/reports");
  pruneOldReports(reportsDir);
  setInterval(() => pruneOldReports(reportsDir), PRUNE_MS);
}
