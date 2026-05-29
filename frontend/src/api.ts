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
  PrereqRun,
  PrereqStep,
  PrereqsBundle,
  Project,
  ProjectVariable,
  SparklinePoint,
  Upload,
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

// ---- Audit (Snapshot & report — strictly read-only) ----
export async function runAudit(projectId: string): Promise<AuditResult> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/audit`, { method: "POST" }));
}

// ---- Manual check triggers ----
export interface CheckUrlsResult {
  checked: number;
  ok: number;
  failed: number;
  durationMs: number;
}

export interface CheckAllResult {
  durationMs: number;
  prereqs: { ok: boolean; totalMs: number | null } | null;
  urls: { checked: number; ok: number };
  flows: { ran: number; ok: number };
}

export async function checkAllUrls(projectId: string): Promise<CheckUrlsResult> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/check-urls`, { method: "POST" })
  );
}

export async function checkEntireProject(projectId: string): Promise<CheckAllResult> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/check-all`, { method: "POST" })
  );
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

export async function copyStepToFlow(stepId: string, targetFlowId: string): Promise<FlowStep> {
  return jsonOrThrow(
    await fetch(`${BASE}/steps/${stepId}/copy-to-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetFlowId }),
    })
  );
}

export async function moveStepToFlow(stepId: string, targetFlowId: string): Promise<FlowStep> {
  return jsonOrThrow(
    await fetch(`${BASE}/steps/${stepId}/move-to-flow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetFlowId }),
    })
  );
}

// ---- Flow Runs ----
export async function runFlowNow(id: string): Promise<FlowRun> {
  return jsonOrThrow(await fetch(`${BASE}/flows/${id}/run`, { method: "POST" }));
}

/**
 * Kick off a flow run and return the runId immediately. Poll fetchFlowRun(runId) for progress.
 * `force=true` bypasses the smart TTL skip-cache — set this for manual "Run now" clicks so the
 * button always performs real work (scheduled runs should pass force=false to spare auth APIs).
 */
export async function runFlowAsync(
  id: string,
  opts: { force?: boolean } = {}
): Promise<{ runId: string; alreadyRunning: boolean }> {
  const qs = opts.force ? "?force=true" : "";
  return jsonOrThrow(await fetch(`${BASE}/flows/${id}/run-async${qs}`, { method: "POST" }));
}

export async function fetchFlowRun(runId: string): Promise<FlowRun> {
  return jsonOrThrow(await fetch(`${BASE}/flow-runs/${runId}`));
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

// ---- Prerequisites ----
export async function fetchPrereqs(projectId: string): Promise<PrereqsBundle> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/prereqs`));
}

export async function addPrereqStep(
  projectId: string,
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
): Promise<PrereqStep> {
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/prereqs/steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  );
}

export async function updatePrereqStep(
  id: string,
  patch: Partial<PrereqStep>
): Promise<PrereqStep> {
  return jsonOrThrow(
    await fetch(`${BASE}/prereq-steps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  );
}

export async function deletePrereqStep(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/prereq-steps/${id}`, { method: "DELETE" }));
}

export async function reorderPrereqSteps(
  projectId: string,
  orderedIds: string[]
): Promise<void> {
  await jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/prereqs/steps/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    })
  );
}

export async function runPrereqsNow(projectId: string): Promise<PrereqRun> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/prereqs/run`, { method: "POST" }));
}

export async function runPrereqsAsync(
  projectId: string,
  opts: { force?: boolean } = {}
): Promise<{ runId: string; alreadyRunning: boolean }> {
  const qs = opts.force ? "?force=true" : "";
  return jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/prereqs/run-async${qs}`, { method: "POST" })
  );
}

export async function fetchPrereqRun(runId: string): Promise<PrereqRun> {
  return jsonOrThrow(await fetch(`${BASE}/prereq-runs/${runId}`));
}

export async function listPrereqRuns(projectId: string, limit = 30): Promise<PrereqRun[]> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/prereqs/runs?limit=${limit}`));
}

export async function fetchProjectVariables(projectId: string): Promise<ProjectVariable[]> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/variables`));
}

export async function clearProjectVariables(projectId: string): Promise<void> {
  await jsonOrThrow(
    await fetch(`${BASE}/projects/${projectId}/variables`, { method: "DELETE" })
  );
}

// ---- Uploads (binary file storage for bodyType="binary") ----
export async function listUploads(projectId: string): Promise<Upload[]> {
  return jsonOrThrow(await fetch(`${BASE}/projects/${projectId}/uploads`));
}

export function uploadFile(
  projectId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Upload> {
  // XHR (not fetch) so we can stream upload-progress events back to the UI.
  // Filename goes URL-encoded so non-ASCII names survive HTTP header transport.
  return new Promise<Upload>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/projects/${projectId}/uploads`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-filename", encodeURIComponent(file.name));
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as Upload); }
        catch { reject(new Error("Invalid server response")); }
      } else {
        let msg = `status ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

export async function deleteUpload(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/uploads/${id}`, { method: "DELETE" }));
}

export function uploadUrl(id: string): string {
  return `${BASE}/uploads/${id}`;
}
