import type {
  ApiKey,
  Assertion,
  AuditResult,
  BodyType,
  CheckRecord,
  Extraction,
  Flow,
  FlowRun,
  FlowWithSteps,
  FlowStep,
  FullSnapshot,
  HttpMethod,
  KeyValue,
  MonitoredUrl,
  Project,
  SparklinePoint,
  UrlStats,
} from "./types";

const BASE = "/api";

async function jsonOrThrow(res: Response) {
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `status ${res.status}`);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export async function fetchStatus(): Promise<FullSnapshot> {
  return jsonOrThrow(await fetch(`${BASE}/status`));
}

// ---- Projects ----
export async function createProject(input: {
  name: string;
  description?: string;
  slackWebhookUrl?: string;
  slackBotToken?: string;
  slackChannel?: string;
}): Promise<Project> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "name" | "description" | "slackWebhookUrl" | "slackBotToken" | "slackChannel">>
): Promise<Project> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function deleteProject(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/projects/${id}`, { method: "DELETE" }));
}

// ---- Keys ----
export async function addApiKey(
  projectId: string,
  input: { name: string; value: string; headerName?: string; headerPrefix?: string }
): Promise<ApiKey> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function removeApiKey(projectId: string, keyId: string): Promise<void> {
  await jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/keys/${keyId}`, { method: "DELETE" })
  );
}

// ---- URLs ----
export async function addUrl(
  projectId: string,
  input: {
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
  }
): Promise<MonitoredUrl> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/urls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function updateUrl(
  id: string,
  patch: Partial<{
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
  }>
): Promise<MonitoredUrl> {
  return jsonOrThrow(
    await fetch(`${BASE}/urls/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function removeUrl(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/urls/${id}`, { method: "DELETE" }));
}

export async function checkUrlNow(id: string): Promise<MonitoredUrl> {
  return jsonOrThrow(await fetch(`${BASE}/urls/${id}/check`, { method: "POST" }));
}

// ---- History / stats ----
export async function fetchHistory(urlId: string, sinceMs?: number): Promise<CheckRecord[]> {
  const qs = sinceMs ? `?since=${sinceMs}` : "";
  return jsonOrThrow(await fetch(`${BASE}/urls/${urlId}/history${qs}`));
}

export async function fetchStats(urlId: string, windowMinutes = 24 * 60): Promise<UrlStats> {
  return jsonOrThrow(await fetch(`${BASE}/urls/${urlId}/stats?windowMinutes=${windowMinutes}`));
}

export async function fetchSparkline(
  urlId: string,
  windowMinutes = 24 * 60,
  buckets = 24
): Promise<SparklinePoint[]> {
  return jsonOrThrow(
    await fetch(`${BASE}/urls/${urlId}/sparkline?windowMinutes=${windowMinutes}&buckets=${buckets}`)
  );
}

// ---- Audit (Check All) ----
export async function runAudit(projectId: string): Promise<AuditResult> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/audit`, { method: "POST" }));
}

// ---- Flows ----
export async function listProjectFlows(projectId: string): Promise<Flow[]> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/flows`));
}

export async function createFlow(
  projectId: string,
  input: { name: string; description?: string; intervalMinutes?: number; stopOnFailure?: boolean }
): Promise<Flow> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function fetchFlow(id: string): Promise<FlowWithSteps> {
  return jsonOrThrow(await fetch(`${BASE}/flows/${id}`));
}

export async function updateFlow(
  id: string,
  patch: Partial<Pick<Flow, "name" | "description" | "intervalMinutes" | "stopOnFailure" | "enabled">>
): Promise<Flow> {
  return jsonOrThrow(
    await fetch(`${BASE}/flows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function deleteFlow(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/flows/${id}`, { method: "DELETE" }));
}

// ---- Flow Steps ----
export async function addFlowStep(
  flowId: string,
  input: {
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
  }
): Promise<FlowStep> {
  return jsonOrThrow(
    await fetch(`${BASE}/flows/${flowId}/steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function updateFlowStep(id: string, patch: Partial<FlowStep>): Promise<FlowStep> {
  return jsonOrThrow(
    await fetch(`${BASE}/steps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function deleteFlowStep(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/steps/${id}`, { method: "DELETE" }));
}

export async function reorderFlowSteps(flowId: string, orderedIds: string[]): Promise<void> {
  await jsonOrThrow(
    await fetch(`${BASE}/flows/${flowId}/steps/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    })
  );
}

// ---- Flow Runs ----
export async function runFlowNow(id: string): Promise<FlowRun> {
  return jsonOrThrow(await fetch(`${BASE}/flows/${id}/run`, { method: "POST" }));
}

export async function listFlowRuns(id: string, limit = 30): Promise<FlowRun[]> {
  return jsonOrThrow(await fetch(`${BASE}/flows/${id}/runs?limit=${limit}`));
}

export async function getCachedVariables(id: string): Promise<Record<string, string>> {
  return jsonOrThrow(await fetch(`${BASE}/flows/${id}/cache`));
}

export async function clearFlowCache(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/flows/${id}/cache`, { method: "DELETE" }));
}
