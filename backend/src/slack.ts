import { readFileSync } from "node:fs";
import { WebClient } from "@slack/web-api";
import type { MonitoredUrl, Project, UrlStats } from "./types.js";

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

// ===== Audit report (uses Bot token + Block Kit + file upload) =====

export interface SlackAuditArgs {
  project: Project;
  urls: MonitoredUrl[];
  stats: Record<string, UrlStats>;
  failingUrls: number;
  okUrls: number;
  reportUrl: string;
  reportPath: string;
  reportFilename: string;
}

export async function sendAuditToSlack(args: SlackAuditArgs): Promise<{ posted: boolean; reason?: string }> {
  const { project } = args;

  // Path 1: Bot token + channel → richest experience (Block Kit + file upload)
  if (project.slackBotToken && project.slackChannel) {
    return sendAuditViaBot(args);
  }

  // Path 2: Webhook only → text summary (no file)
  if (project.slackWebhookUrl) {
    return sendAuditViaWebhook(args);
  }

  return { posted: false, reason: "No Slack credentials configured for this project." };
}

async function sendAuditViaBot(args: SlackAuditArgs): Promise<{ posted: boolean; reason?: string }> {
  const { project, urls, stats, failingUrls, okUrls, reportUrl, reportPath, reportFilename } = args;
  try {
    const client = new WebClient(project.slackBotToken);

    const blocks = buildAuditBlocks({
      project,
      urls,
      stats,
      failingUrls,
      okUrls,
      reportUrl,
    });

    await client.chat.postMessage({
      channel: project.slackChannel,
      text: `Audit report for ${project.name}: ${okUrls} OK, ${failingUrls} failing.`,
      blocks,
    });

    // Upload the HTML report as a file attachment
    try {
      await client.files.uploadV2({
        channel_id: project.slackChannel,
        file: readFileSync(reportPath),
        filename: reportFilename,
        title: `Audit report — ${project.name}`,
        initial_comment: "Full HTML report attached.",
      });
    } catch (e) {
      console.warn("[slack] file upload failed (message still posted):", e instanceof Error ? e.message : e);
    }

    return { posted: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[slack] bot post failed:", msg);
    return { posted: false, reason: msg };
  }
}

async function sendAuditViaWebhook(args: SlackAuditArgs): Promise<{ posted: boolean; reason?: string }> {
  const { project, urls, failingUrls, okUrls, reportUrl } = args;
  try {
    const lines = [
      `:bar_chart: *Audit report — ${project.name}*`,
      `${okUrls} healthy · ${failingUrls} failing · ${urls.length} total`,
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

function buildAuditBlocks(args: {
  project: Project;
  urls: MonitoredUrl[];
  stats: Record<string, UrlStats>;
  failingUrls: number;
  okUrls: number;
  reportUrl: string;
}): any[] {
  const { project, urls, stats, failingUrls, okUrls, reportUrl } = args;
  const failing = urls.filter(
    (u) => u.statusGroup === "5xx" || u.statusGroup === "error" || u.statusGroup === "4xx"
  );

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📊 Audit — ${project.name}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Endpoints checked*\n${urls.length}` },
        { type: "mrkdwn", text: `*Healthy*\n✅ ${okUrls}` },
        { type: "mrkdwn", text: `*Failing*\n🔴 ${failingUrls}` },
        { type: "mrkdwn", text: `*Time*\n${new Date().toLocaleString()}` },
      ],
    },
    { type: "divider" },
  ];

  if (failing.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*❌ Failing endpoints:*\n" +
          failing
            .slice(0, 8)
            .map((u) => {
              const s = stats[u.id];
              const rate = s ? ` · ${s.failureRatePct}% fail (24h)` : "";
              return `• \`${u.method}\` ${u.url} — ${u.statusGroup ?? "?"}${u.statusCode ? ` (${u.statusCode})` : ""}${rate}\n  _${u.errorReason ?? ""}_`;
            })
            .join("\n"),
      },
    });
    if (failing.length > 8) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_…and ${failing.length - 8} more. See full report._` }],
      });
    }
    blocks.push({ type: "divider" });
  }

  if (reportUrl) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📎 *Full HTML report* (also attached as file)\n<${reportUrl}|Open report>` },
    });
  }

  return blocks;
}
