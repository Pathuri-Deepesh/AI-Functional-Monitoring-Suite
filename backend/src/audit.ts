import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  getProject,
  getUrlSparkline,
  getUrlStats,
  listFlowRuns,
  listFlowsByProject,
  listUrlsByProject,
} from "./store.js";
import { checkAllInProject } from "./monitor.js";
import { runFlow } from "./flowRunner.js";
import { renderReportHtml } from "./report.js";
import { sendAuditToSlack } from "./slack.js";
import type { Flow, FlowRun, UrlStats } from "./types.js";

export interface AuditResult {
  projectId: string;
  reportFilename: string;
  reportPath: string;
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
}

/**
 * Run an audit on a project:
 *   1. (optional) Re-check every URL + re-run every enabled flow when refresh=true
 *   2. Generate an HTML report from the current saved state
 *   3. Deliver via Slack (Block Kit + file upload if bot token; webhook fallback)
 *
 * Default `refresh=false` = snapshot of what the UI currently shows (fast).
 * Pass `refresh=true` to force a full re-run before the report — used by the
 * scheduler or any caller that wants the freshest possible numbers.
 */
export async function runAuditAndDeliver(
  projectId: string,
  reportsDir: string,
  baseUrl = "http://localhost:4000",
  options: { refresh?: boolean } = {}
): Promise<AuditResult> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");

  // 1. Optionally re-check URLs + re-run flows in parallel before snapshotting.
  if (options.refresh) {
    const urlsTask = checkAllInProject(projectId, 8);
    const flows = listFlowsByProject(projectId).filter((f) => f.enabled);
    const flowRunsTask = Promise.all(flows.map((f) => runFlow(f.id)));
    await Promise.all([urlsTask, flowRunsTask]);
  }

  // 2. Load URLs + per-URL stats + sparklines (24h window) for the report
  const urls = listUrlsByProject(projectId);
  const stats: Record<string, UrlStats> = {};
  for (const u of urls) stats[u.id] = getUrlStats(u.id, 24 * 60);
  const sparklines: Record<string, number[]> = {};
  for (const u of urls) {
    sparklines[u.id] = getUrlSparkline(u.id, 24 * 60, 24).map((p) => p.avgLatencyMs ?? 0);
  }

  // 3. Load flows + their latest runs for the report
  const flowSummaries: Array<{ flow: Flow; latestRun: FlowRun | null }> = [];
  for (const f of listFlowsByProject(projectId)) {
    const runs = listFlowRuns(f.id, 1);
    flowSummaries.push({ flow: f, latestRun: runs[0] ?? null });
  }

  // 4. Render HTML
  const html = renderReportHtml({ project, urls, stats, sparklines, flowSummaries });
  const filename = `${slugify(project.name)}-${stamp()}-${randomUUID().slice(0, 8)}.html`;
  const reportPath = join(reportsDir, filename);
  writeFileSync(reportPath, html, "utf8");
  const reportUrl = `${baseUrl}/reports/${filename}`;

  // 5. Aggregate counts
  const failingUrls = urls.filter(
    (u) => u.statusGroup === "error" || u.statusGroup === "5xx" || u.statusGroup === "4xx"
  ).length;
  const okUrls = urls.length - failingUrls;

  const failingFlows = flowSummaries.filter((s) => s.latestRun?.ok === false).length;
  const okFlows = flowSummaries.filter((s) => s.latestRun?.ok === true).length;
  const totalFlows = flowSummaries.length;

  // 6. Slack delivery
  const slack = await sendAuditToSlack({
    project,
    urls,
    stats,
    flowSummaries,
    failingUrls,
    okUrls,
    failingFlows,
    okFlows,
    reportUrl,
    reportPath,
    reportFilename: filename,
  });

  return {
    projectId,
    reportFilename: filename,
    reportPath,
    reportUrl,
    totalUrls: urls.length,
    failingUrls,
    okUrls,
    totalFlows,
    failingFlows,
    okFlows,
    slack,
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
