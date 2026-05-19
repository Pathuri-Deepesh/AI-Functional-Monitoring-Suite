import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  getProject,
  getUrlSparkline,
  getUrlStats,
  listUrlsByProject,
} from "./store.js";
import { checkAllInProject } from "./monitor.js";
import { renderReportHtml } from "./report.js";
import { sendAuditToSlack } from "./slack.js";
import type { MonitoredUrl, UrlStats } from "./types.js";

export interface AuditResult {
  projectId: string;
  reportFilename: string;
  reportPath: string;
  reportUrl: string; // local URL like http://localhost:4000/reports/abc.html
  totalUrls: number;
  failingUrls: number;
  okUrls: number;
  slack: { posted: boolean; reason?: string };
}

export async function runAuditAndDeliver(
  projectId: string,
  reportsDir: string,
  baseUrl = "http://localhost:4000"
): Promise<AuditResult> {
  const project = getProject(projectId);
  if (!project) throw new Error("Project not found");

  // 1. Re-check every URL in the project right now
  await checkAllInProject(projectId, 8);
  const urls = listUrlsByProject(projectId);

  // 2. Compute 24h stats per URL for the report
  const stats: Record<string, UrlStats> = {};
  for (const u of urls) {
    stats[u.id] = getUrlStats(u.id, 24 * 60);
  }
  const sparklines: Record<string, number[]> = {};
  for (const u of urls) {
    sparklines[u.id] = getUrlSparkline(u.id, 24 * 60, 24).map((p) => p.avgLatencyMs ?? 0);
  }

  // 3. Render HTML and write to disk
  const html = renderReportHtml({ project, urls, stats, sparklines });
  const filename = `${slugify(project.name)}-${stamp()}-${randomUUID().slice(0, 8)}.html`;
  const reportPath = join(reportsDir, filename);
  writeFileSync(reportPath, html, "utf8");
  const reportUrl = `${baseUrl}/reports/${filename}`;

  // 4. Stats summary
  const failingUrls = urls.filter(
    (u) => u.statusGroup === "error" || u.statusGroup === "5xx" || u.statusGroup === "4xx"
  ).length;
  const okUrls = urls.length - failingUrls;

  // 5. Send to Slack (Bot token + Block Kit + file upload preferred; falls back to webhook)
  const slack = await sendAuditToSlack({
    project,
    urls,
    stats,
    failingUrls,
    okUrls,
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
