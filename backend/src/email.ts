import nodemailer, { type Transporter } from "nodemailer";
import type { Flow, FlowRun, FlowStep, MonitoredUrl, Project, UrlStats } from "./types.js";

// ===== Transport (lazy singleton; re-evaluated lazily so test/dev restarts pick up .env edits) =====
let cachedTransport: Transporter | null | undefined; // undefined = not yet probed, null = SMTP not configured

function getTransport(): Transporter | null {
  if (cachedTransport !== undefined) return cachedTransport;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    cachedTransport = null;
    return null;
  }
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = SMTPS, 587 = STARTTLS (auto-upgraded)
    auth: { user, pass },
  });
  return cachedTransport;
}

function fromAddress(): string {
  return process.env.SMTP_FROM || process.env.SMTP_USER || "";
}

function parseRecipients(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type SendResult = { sent: boolean; reason?: string };

async function sendMail(args: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; path: string; contentType?: string }>;
}): Promise<SendResult> {
  const t = getTransport();
  if (!t) return { sent: false, reason: "SMTP not configured" };
  if (args.to.length === 0) return { sent: false, reason: "no recipients" };
  try {
    await t.sendMail({
      from: fromAddress(),
      to: args.to.join(", "),
      subject: args.subject,
      text: args.text,
      html: args.html,
      attachments: args.attachments,
    });
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[email] sendMail failed:", msg);
    return { sent: false, reason: msg };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== Per-URL failure email (mirrors sendSlackAlert / formatAlert) =====
export async function sendUrlFailureEmail(
  project: Project,
  url: MonitoredUrl
): Promise<SendResult> {
  const to = parseRecipients(project.notificationEmails);
  if (to.length === 0) return { sent: false, reason: "no recipients" };
  const status = url.statusCode != null ? `HTTP ${url.statusCode}` : "no response";
  const reason = url.errorReason ?? "Unknown failure";
  const desc = url.description ? ` (${url.description})` : "";
  const totalMs = url.timings?.totalMs ?? null;
  const latency = totalMs != null ? ` · ${totalMs}ms` : "";
  const text = [
    `🚨 ${project.name} — monitor failure`,
    ``,
    `URL: ${url.url}${desc}`,
    `Status: ${status} (${url.statusGroup ?? "?"})${latency}`,
    `Reason: ${reason}`,
    `Time: ${url.lastChecked ?? new Date().toISOString()}`,
  ].join("\n");
  return sendMail({
    to,
    subject: `[${project.name}] Monitor failure: ${url.url}`,
    text,
  });
}

// ===== Per-flow failure email (mirrors sendFlowFailureAlert) =====
export async function sendFlowFailureEmail(
  flow: Flow,
  run: FlowRun,
  project: Project,
  failedStep: FlowStep | null = null
): Promise<SendResult> {
  const to = parseRecipients(project.notificationEmails);
  if (to.length === 0) return { sent: false, reason: "no recipients" };
  const failedStepResult = run.stepResults.find((sr) => sr.stepId === run.failedAtStepId);
  const failedStepLabel = failedStepResult
    ? `step ${failedStepResult.position} (${failedStepResult.statusCode ? `HTTP ${failedStepResult.statusCode}` : "no response"})`
    : "unknown step";
  const reason = failedStepResult?.errorReason ?? "see flow run details";
  const totalMs = run.totalMs != null ? ` · ${run.totalMs}ms` : "";
  const stepLine = failedStep ? `Step desc: ${failedStep.description || "(no description)"}` : "";
  const text = [
    `🚨 ${project.name} — flow failure`,
    ``,
    `Flow: ${flow.name}`,
    `Failed at: ${failedStepLabel}${totalMs}`,
    stepLine,
    `Reason: ${reason}`,
    `Time: ${new Date(run.startedAt).toISOString()}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return sendMail({
    to,
    subject: `[${project.name}] Flow failure: ${flow.name}`,
    text,
  });
}

// ===== Audit / Snapshot email (mirrors sendAuditToSlack webhook path + attaches HTML report) =====
export interface EmailAuditArgs {
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

export async function sendAuditEmail(args: EmailAuditArgs): Promise<SendResult> {
  const {
    project,
    urls,
    flowSummaries,
    failingUrls,
    okUrls,
    failingFlows,
    okFlows,
    reportUrl,
    reportPath,
    reportFilename,
  } = args;
  const to = parseRecipients(project.notificationEmails);
  if (to.length === 0) return { sent: false, reason: "no recipients" };

  const total = urls.length + flowSummaries.length;
  const totalFailing = failingUrls + failingFlows;
  const totalOk = okUrls + okFlows;

  // Build per-failure list. Mirrors the failure-detection logic in audit.ts
  // (statusGroup-based for URLs, latestRun.ok===false for flows). Anchor IDs
  // match the <tr id="url-..."> / <tr id="flow-..."> emitted by report.ts so
  // every "View details" link jumps to the right row inside the HTML report.
  type FailureRow = {
    type: "URL" | "FLOW";
    name: string;
    reason: string;
    anchorId: string;
  };
  const failures: FailureRow[] = [
    ...urls
      .filter(
        (u) => u.statusGroup === "error" || u.statusGroup === "5xx" || u.statusGroup === "4xx"
      )
      .map<FailureRow>((u) => ({
        type: "URL",
        name: `${u.method} ${u.url}`,
        reason: u.errorReason ?? "Failed (no reason recorded)",
        anchorId: `url-${u.id}`,
      })),
    ...flowSummaries
      .filter((s) => s.latestRun?.ok === false)
      .map<FailureRow>(({ flow, latestRun }) => {
        const failed = latestRun?.stepResults.find((sr) => !sr.ok && !sr.skipped);
        const stepLabel = failed ? `step ${failed.position}` : "unknown step";
        return {
          type: "FLOW",
          name: `${flow.name} — ${stepLabel}`,
          reason: failed?.errorReason ?? "Failed (no reason recorded)",
          anchorId: `flow-${flow.id}`,
        };
      }),
  ];

  // ===== Plain-text fallback (every client supports text) =====
  const textFailures =
    failures.length === 0
      ? `✅ All ${total} monitored endpoints are healthy.`
      : [
          `🚨 ${totalFailing} failure${totalFailing === 1 ? "" : "s"} need attention:`,
          ``,
          ...failures.map(
            (f, i) =>
              `${i + 1}. [${f.type}] ${f.name}\n   Reason: ${f.reason}${reportUrl ? `\n   Details: ${reportUrl}#${f.anchorId}` : ""}`
          ),
        ].join("\n");

  const text = [
    `📊 Audit report — ${project.name}`,
    ``,
    `${totalOk} healthy · ${totalFailing} failing · ${total} total`,
    `🔗 URLs: ${okUrls} OK · ${failingUrls} failing (of ${urls.length})`,
    flowSummaries.length > 0
      ? `📋 Flows: ${okFlows} OK · ${failingFlows} failing (of ${flowSummaries.length})`
      : "",
    ``,
    textFailures,
    ``,
    reportUrl ? `Full report: ${reportUrl}` : `Full HTML report attached.`,
  ]
    .filter((l) => l !== null && l !== undefined)
    .join("\n");

  // ===== HTML body (clickable per-failure links + at-a-glance hero) =====
  const heroColor = totalFailing > 0 ? "#dc2626" : "#16a34a";
  const heroBg = totalFailing > 0 ? "#fef2f2" : "#f0fdf4";
  const heroText =
    totalFailing > 0
      ? `<span style="font-size:32px;font-weight:800;color:${heroColor};">${totalFailing}</span> endpoint${totalFailing === 1 ? "" : "s"} need attention out of ${total} monitored`
      : `<span style="font-size:24px;color:${heroColor};">&check;</span> All ${total} monitored endpoints are healthy`;

  const failuresHtmlBlock =
    failures.length === 0
      ? ""
      : `
        <h2 style="margin:24px 0 12px 0;font-size:18px;color:#0f172a;">🚨 Failures requiring attention (${totalFailing})</h2>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;">
          <thead>
            <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
              <th align="left" style="padding:10px 12px;color:#475569;font-weight:600;">Type</th>
              <th align="left" style="padding:10px 12px;color:#475569;font-weight:600;">Name</th>
              <th align="left" style="padding:10px 12px;color:#475569;font-weight:600;">Reason</th>
              <th align="left" style="padding:10px 12px;color:#475569;font-weight:600;">Details</th>
            </tr>
          </thead>
          <tbody>
            ${failures
              .map(
                (f) => `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:10px 12px;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:${f.type === "URL" ? "#dc2626" : "#ea580c"};">${f.type}</span></td>
                <td style="padding:10px 12px;color:#0f172a;font-family:Menlo,Consolas,monospace;font-size:13px;">${escapeHtml(f.name)}</td>
                <td style="padding:10px 12px;color:#475569;font-family:Menlo,Consolas,monospace;font-size:13px;">${escapeHtml(f.reason)}</td>
                <td style="padding:10px 12px;">${reportUrl ? `<a href="${escapeHtml(reportUrl)}#${escapeHtml(f.anchorId)}" style="color:#2563eb;text-decoration:underline;">View details &rarr;</a>` : "<span style=\"color:#94a3b8;\">attached</span>"}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #e2e8f0;">
    <h1 style="margin:0 0 4px 0;font-size:20px;">📊 Audit report — ${escapeHtml(project.name)}</h1>
    <p style="margin:0 0 16px 0;color:#64748b;font-size:13px;">Generated ${new Date().toLocaleString()}</p>

    <div style="background:${heroBg};border:1px solid ${heroColor}33;border-radius:6px;padding:16px;margin-bottom:16px;">
      ${heroText}
    </div>

    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:#475569;margin-bottom:8px;">
      <tr>
        <td style="padding:4px 0;">🔗 <b>URLs:</b> ${okUrls} OK · ${failingUrls} failing (of ${urls.length})</td>
      </tr>
      ${flowSummaries.length > 0 ? `<tr><td style="padding:4px 0;">📋 <b>Flows:</b> ${okFlows} OK · ${failingFlows} failing (of ${flowSummaries.length})</td></tr>` : ""}
    </table>

    ${failuresHtmlBlock}

    <p style="margin:24px 0 0 0;font-size:13px;color:#64748b;">
      ${reportUrl ? `<a href="${escapeHtml(reportUrl)}" style="color:#2563eb;text-decoration:underline;">Open full HTML report &rarr;</a> &nbsp;·&nbsp; ` : ""}Also attached as <code>${escapeHtml(reportFilename)}</code>.
    </p>
  </div>
</body></html>`;

  return sendMail({
    to,
    subject: `[${project.name}] Audit report — ${totalOk} OK, ${totalFailing} failing`,
    text,
    html,
    attachments: [
      {
        filename: reportFilename,
        path: reportPath,
        contentType: "text/html",
      },
    ],
  });
}
