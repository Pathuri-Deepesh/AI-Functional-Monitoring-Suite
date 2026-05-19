import { readFileSync } from "node:fs";
import { WebClient } from "@slack/web-api";
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
export async function sendFlowFailureAlert(
  flow: Flow,
  run: FlowRun,
  project: Project
): Promise<void> {
  if (!project.slackWebhookUrl) return;
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
    await fetch(project.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.warn("[slack] flow alert failed:", e instanceof Error ? e.message : e);
  }
}

// ===== Audit report (uses Bot token + Block Kit + file upload) =====

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
  const { project, reportUrl, reportPath, reportFilename, failingUrls, okUrls, failingFlows, okFlows } = args;
  try {
    const client = new WebClient(project.slackBotToken);

    const blocks = buildAuditBlocks(args);

    const totalChecked = okUrls + failingUrls + okFlows + failingFlows;
    const totalFailing = failingUrls + failingFlows;
    await client.chat.postMessage({
      channel: project.slackChannel,
      text: `Audit report for ${project.name}: ${totalChecked - totalFailing} OK, ${totalFailing} failing.`,
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

function buildAuditBlocks(args: SlackAuditArgs): any[] {
  const { project, urls, stats, flowSummaries, failingUrls, okUrls, failingFlows, okFlows, reportUrl } = args;
  const total = urls.length + flowSummaries.length;
  const totalFailing = failingUrls + failingFlows;
  const totalOk = okUrls + okFlows;

  const failingUrlList = urls.filter(
    (u) => u.statusGroup === "5xx" || u.statusGroup === "error" || u.statusGroup === "4xx"
  );
  const failingFlowList = flowSummaries.filter((s) => s.latestRun?.ok === false);

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📊 Audit — ${project.name}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Endpoints checked*\n${total}` },
        { type: "mrkdwn", text: `*Healthy*\n✅ ${totalOk}` },
        { type: "mrkdwn", text: `*Failing*\n${totalFailing > 0 ? "🔴" : "✅"} ${totalFailing}` },
        { type: "mrkdwn", text: `*Time*\n${new Date().toLocaleString()}` },
      ],
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*🔗 Standalone URLs*\n${okUrls} OK · ${failingUrls} failing (of ${urls.length})`,
        },
        {
          type: "mrkdwn",
          text: `*📋 Flows*\n${okFlows} OK · ${failingFlows} failing (of ${flowSummaries.length})`,
        },
      ],
    },
    { type: "divider" },
  ];

  if (failingUrlList.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*❌ Failing URLs:*\n" +
          failingUrlList
            .slice(0, 6)
            .map((u) => {
              const s = stats[u.id];
              const rate = s ? ` · ${s.failureRatePct}% fail (24h)` : "";
              return `• \`${u.method}\` ${u.url} — ${u.statusGroup ?? "?"}${u.statusCode ? ` (${u.statusCode})` : ""}${rate}\n  _${u.errorReason ?? ""}_`;
            })
            .join("\n"),
      },
    });
    if (failingUrlList.length > 6) {
      blocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: `_…and ${failingUrlList.length - 6} more URL failure(s). See full report._` },
        ],
      });
    }
  }

  if (failingFlowList.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*❌ Failing Flows:*\n" +
          failingFlowList
            .slice(0, 6)
            .map(({ flow, latestRun }) => {
              const failedStep = latestRun?.stepResults.find((sr) => !sr.ok && !sr.skipped);
              const at = failedStep ? `step ${failedStep.position}` : "?";
              const reason = failedStep?.errorReason ?? "see report";
              return `• *${flow.name}* — failed at ${at}\n  _${reason}_`;
            })
            .join("\n"),
      },
    });
    if (failingFlowList.length > 6) {
      blocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: `_…and ${failingFlowList.length - 6} more flow failure(s). See full report._` },
        ],
      });
    }
  }

  if (totalFailing > 0) blocks.push({ type: "divider" });

  if (reportUrl) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📎 *Full HTML report* (also attached as file)\n<${reportUrl}|Open report>`,
      },
    });
  }

  return blocks;
}
