import { randomUUID } from "node:crypto";
import { saveReport } from "./storage.js";
import {
  getProject,
  getUrlSparkline,
  getUrlStats,
  listFlowRuns,
  listFlowsByProject,
  listUrlsByProject,
} from "./store.js";
import { renderReportHtml } from "./report.js";
import { sendAuditToSlack } from "./slack.js";
import { sendAuditEmail } from "./email.js";
import type { Flow, FlowRun, UrlStats } from "./types.js";

export interface AuditResult {
  projectId: string;
  reportFilename: string;
  reportUrl: string;
  // URL counts
  totalUrls: number;
  failingUrls: number;
  okUrls: number;
  // Flow counts (NEW)
  totalFlows: number;
  failingFlows: number;
  okFlows: number;
  // Slack
  slack: { posted: boolean; reason?: string };
  // Email
  email: { sent: boolean; reason?: string };
}

/**
 * Run an audit on a project — strictly READ-ONLY:
 *   1. Generate an HTML report from the current saved state (no re-checks)
 *   2. Deliver via Slack (Block Kit + file upload if bot token; webhook fallback)
 *
 * The audit never triggers fresh checks. Use the dedicated check endpoints
 * (POST /api/projects/:id/check-urls or /check-all) to refresh state first
 * if the latest numbers matter.
 */
export async function runAuditAndDeliver(
  projectId: string,
  baseUrl = "http://localhost:4000"
): Promise<AuditResult> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");

  // Load URLs + per-URL stats + sparklines (24h window) for the report
  const urls = listUrlsByProject(projectId);
  const stats: Record<string, UrlStats> = {};
  for (const u of urls) stats[u.id] = getUrlStats(u.id, 24 * 60);
  const sparklines: Record<string, number[]> = {};
  for (const u of urls) {
    sparklines[u.id] = getUrlSparkline(u.id, 24 * 60, 24).map((p) => p.avgLatencyMs ?? 0);
  }

  // Load flows + their latest runs for the report
  const flowSummaries: Array<{ flow: Flow; latestRun: FlowRun | null }> = [];
  for (const f of listFlowsByProject(projectId)) {
    const runs = listFlowRuns(f.id, 1);
    flowSummaries.push({ flow: f, latestRun: runs[0] ?? null });
  }

  // Render HTML and store it (S3 when configured, local disk otherwise) under
  // reports/<projectId>/<filename> so report history is browsable per project.
  const html = renderReportHtml({ project, urls, stats, sparklines, flowSummaries });
  const filename = `${slugify(project.name)}-${stamp()}-${randomUUID().slice(0, 8)}.html`;
  const reportBytes = Buffer.from(html, "utf8");
  await saveReport(project.id, filename, reportBytes);
  // Serve route is GET /reports/:projectId/:filename (see app.ts).
  const reportUrl = `${baseUrl}/reports/${project.id}/${filename}`;

  // Aggregate counts
  const failingUrls = urls.filter(
    (u) => u.statusGroup === "error" || u.statusGroup === "5xx" || u.statusGroup === "4xx"
  ).length;
  const okUrls = urls.length - failingUrls;

  const failingFlows = flowSummaries.filter((s) => s.latestRun?.ok === false).length;
  const okFlows = flowSummaries.filter((s) => s.latestRun?.ok === true).length;
  const totalFlows = flowSummaries.length;

  // Slack + Email delivery (parallel; each channel has its own internal gate)
  const deliveryArgs = {
    project,
    urls,
    stats,
    flowSummaries,
    failingUrls,
    okUrls,
    failingFlows,
    okFlows,
    reportUrl,
    reportBytes,
    reportFilename: filename,
  };
  const [slackSettled, emailSettled] = await Promise.allSettled([
    sendAuditToSlack(deliveryArgs),
    sendAuditEmail(deliveryArgs),
  ]);
  const slack =
    slackSettled.status === "fulfilled"
      ? slackSettled.value
      : { posted: false, reason: String(slackSettled.reason) };
  const email =
    emailSettled.status === "fulfilled"
      ? emailSettled.value
      : { sent: false, reason: String(emailSettled.reason) };

  return {
    projectId,
    reportFilename: filename,
    reportUrl,
    totalUrls: urls.length,
    failingUrls,
    okUrls,
    totalFlows,
    failingFlows,
    okFlows,
    slack,
    email,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function stamp(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    "_",
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
  ].join("");
}
