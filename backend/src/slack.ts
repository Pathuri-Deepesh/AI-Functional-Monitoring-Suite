import type { Flow, FlowRun, MonitoredUrl, Project, UrlStats } from "./types.js";

// ===== Per-URL failure alert (uses webhook) =====
export async function sendSlackAlert(
  webhookUrl: string,
  project: Project,
  url: MonitoredUrl
): Promise<void> {
  if (!webhookUrl) return;
  const text = formatAlert(project, url);
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn("[slack] webhook alert failed:", e instanceof Error ? e.message : e);
  }
}

function formatAlert(project: Project, url: MonitoredUrl): string {
  const status = url.statusCode != null ? `HTTP ${url.statusCode}` : "no response";
  const reason = url.errorReason ?? "Unknown failure";
  const desc = url.description ? ` _${url.description}_` : "";
  const totalMs = url.timings?.totalMs ?? null;
  const latency = totalMs != null ? ` · ${totalMs}ms` : "";
  return [
    `:rotating_light: *${project.name}* — monitor failure`,
    `*URL:* ${url.url}${desc}`,
    `*Status:* ${status} (${url.statusGroup ?? "?"})${latency}`,
    `*Reason:* ${reason}`,
    `*Time:* ${url.lastChecked ?? new Date().toISOString()}`,
  ].join("\n");
}

// ===== Per-flow failure alert (uses webhook) =====
// Phase 1.27.13 — accepts an explicit webhookUrl so the caller can pick
// general vs latency channel via pickSlackWebhook(). Returns early on empty.
export async function sendFlowFailureAlert(
  webhookUrl: string,
  flow: Flow,
  run: FlowRun,
  project: Project
): Promise<void> {
  if (!webhookUrl) return;
  const failedStep = run.stepResults.find((sr) => sr.stepId === run.failedAtStepId);
  const failedStepLabel = failedStep
    ? `step ${failedStep.position} (${failedStep.statusCode ? `HTTP ${failedStep.statusCode}` : "no response"})`
    : "unknown step";
  const reason = failedStep?.errorReason ?? "see flow run details";
  const totalMs = run.totalMs != null ? ` · ${run.totalMs}ms` : "";
  const text = [
    `:rotating_light: *${project.name}* — flow failure`,
    `*Flow:* ${flow.name}`,
    `*Failed at:* ${failedStepLabel}${totalMs}`,
    `*Reason:* ${reason}`,
    `*Time:* ${new Date(run.startedAt).toISOString()}`,
  ].join("\n");
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn("[slack] flow alert failed:", e instanceof Error ? e.message : e);
  }
}

// ===== Audit report (webhook only — Phase 1.25 dropped the bot-token + Block Kit path) =====

export interface SlackAuditArgs {
  project: Project;
  urls: MonitoredUrl[];
  stats: Record<string, UrlStats>;
  flowSummaries: Array<{ flow: Flow; latestRun: FlowRun | null }>;
  failingUrls: number;
  okUrls: number;
  failingFlows: number;
  okFlows: number;
  reportUrl: string;
  reportFilename: string;
}

export async function sendAuditToSlack(args: SlackAuditArgs): Promise<{ posted: boolean; reason?: string }> {
  const { project } = args;
  if (!project.slackWebhookUrl) {
    return { posted: false, reason: "No Slack webhook configured for this project." };
  }
  return sendAuditViaWebhook(args);
}

async function sendAuditViaWebhook(args: SlackAuditArgs): Promise<{ posted: boolean; reason?: string }> {
  const { project, urls, flowSummaries, failingUrls, okUrls, failingFlows, okFlows, reportUrl } = args;
  try {
    const total = urls.length + flowSummaries.length;
    const totalFailing = failingUrls + failingFlows;
    const totalOk = okUrls + okFlows;
    const lines = [
      `:bar_chart: *Audit report — ${project.name}*`,
      `*${totalOk}* healthy · *${totalFailing}* failing · ${total} total`,
      `🔗 URLs: ${okUrls} OK · ${failingUrls} failing (of ${urls.length})`,
      flowSummaries.length > 0
        ? `📋 Flows: ${okFlows} OK · ${failingFlows} failing (of ${flowSummaries.length})`
        : "",
      reportUrl ? `Report: ${reportUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await fetch(project.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines }),
    });
    return { posted: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { posted: false, reason: msg };
  }
}
