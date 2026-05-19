import { reasonForError, reasonForStatus } from "./errorReason.js";
import { sendSlackAlert } from "./slack.js";
import { evaluateAssertions } from "./assertions.js";
import {
  getProject,
  getUrl,
  listFlows,
  listProjects,
  listUrls,
  recordCheck,
  resolveApiKeyHeader,
} from "./store.js";
import { pruneOldChecks } from "./db.js";
import { timedFetch } from "./timing.js";
import { runFlow } from "./flowRunner.js";
import type { FullSnapshot, MonitoredUrl, StatusGroup } from "./types.js";

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

async function doCheck(urlId: string): Promise<MonitoredUrl | undefined> {
  const url = getUrl(urlId);
  if (!url) return undefined;
  const project = getProject(url.projectId);
  const wasFailing =
    url.statusGroup === "error" || url.statusGroup === "5xx" || url.statusGroup === "4xx";

  const headers: Record<string, string> = {};
  const auth = resolveApiKeyHeader(url);
  if (auth) headers[auth.name] = auth.value;

  const result = await timedFetch({
    url: url.url,
    method: url.method,
    bodyType: url.bodyType,
    body: url.body,
    bodyContentType: url.bodyContentType,
    extraHeaders: headers,
    customHeaders: url.customHeaders,
    queryParams: url.queryParams,
  });

  const checkedAt = Date.now();
  let statusCode: number | null = null;
  let statusGroup: StatusGroup | null = null;
  let errorReason: string | null = null;

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

  const assertionResults = evaluateAssertions(url.assertions, {
    statusCode,
    totalMs: result.timings.totalMs,
    responseBody: result.responseBody,
  });
  const allAssertionsPassed = assertionResults.every((r) => r.passed);
  const statusOk = statusGroup === "2xx" || statusGroup === "3xx";
  const ok = statusOk && allAssertionsPassed;

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

  // Slack: alert on transition into failing state
  const isFailingNow = !ok;
  if (isFailingNow && !wasFailing && project?.slackWebhookUrl) {
    void sendSlackAlert(project.slackWebhookUrl, project, updated);
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

  // 1) Due standalone URLs
  const dueUrls: MonitoredUrl[] = [];
  for (const u of listUrls()) {
    const intervalMs = Math.max(60_000, u.intervalMinutes * 60_000);
    const last = u.lastChecked ? Date.parse(u.lastChecked) : 0;
    if (!last || now - last >= intervalMs) dueUrls.push(u);
  }

  // 2) Due flows (whole flow runs atomically when its interval has elapsed)
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
}
