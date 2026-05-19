import type {
  ApiKey,
  Assertion,
  AuditResult,
  BodyType,
  CheckRecord,
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
