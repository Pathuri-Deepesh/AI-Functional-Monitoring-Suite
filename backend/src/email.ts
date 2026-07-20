/**
 * Phase 1.27.8 — SMTP → AWS SES migration.
 *
 * All email goes through AWS SESv2 (`@aws-sdk/client-sesv2`). Nodemailer + SMTP
 * are GONE. Credentials resolve via the standard AWS SDK chain:
 *
 *   1. Env vars: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
 *   2. Shared credentials file: ~/.aws/credentials (profile = AWS_PROFILE or "default")
 *   3. IAM role: when running on EC2 / ECS / Lambda / EKS — no creds in env at all
 *
 * Required env to actually send:
 *   - AWS_REGION             — e.g. "us-east-1"
 *   - SES_FROM_EMAIL         — the verified SES sender (full From header allowed,
 *                              e.g. 'Monitoring Suite <monitor@example.com>')
 *
 * Optional env:
 *   - SES_CONFIGURATION_SET  — SES configuration set name (for engagement events,
 *                              bounce/complaint topics, IP pool selection, etc.)
 *
 * If AWS_REGION + SES_FROM_EMAIL are not BOTH set, every send returns
 *   { sent: false, reason: "SES not configured (...)" }
 * and the rest of the monitoring loop keeps running normally — same graceful
 * disable as the old SMTP path. Identical public API.
 */
import { readFile } from "node:fs/promises";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type {
  AssertionResult,
  Flow,
  FlowRun,
  FlowStep,
  MonitoredUrl,
  Project,
  UrlStats,
} from "./types.js";

export type FailureCategory = "latency" | "general";

/**
 * Phase 1.27.2 — classify a failure for routing to the latency-only or general
 * recipient list. Returns "latency" iff EVERY failed assertion is of type
 * `latency-under`. Unchanged from the SMTP-era implementation.
 */
export function classifyFailure(assertions: AssertionResult[]): FailureCategory {
  const failed = assertions.filter((a) => !a.passed);
  if (failed.length === 0) return "general";
  return failed.every((a) => a.type === "latency-under") ? "latency" : "general";
}

export function pickRecipients(project: Project, category: FailureCategory): string {
  if (category === "latency" && project.latencyFailureEmails?.trim()) {
    return project.latencyFailureEmails;
  }
  return project.notificationEmails;
}

/**
 * Phase 1.27.13 — Slack twin of pickRecipients. Latency-only failures route to
 * `latencySlackWebhookUrl` when populated; everything else (including latency
 * failures when the dedicated webhook is empty) routes to `slackWebhookUrl`.
 * Returns "" when neither is configured — callers should early-return on that.
 */
export function pickSlackWebhook(project: Project, category: FailureCategory): string {
  if (category === "latency" && project.latencySlackWebhookUrl?.trim()) {
    return project.latencySlackWebhookUrl;
  }
  return project.slackWebhookUrl;
}

// ===== SES client (lazy singleton; re-evaluated lazily so tsx-watch restarts
// pick up .env edits without a full process recycle every time) ============
let cachedClient: SESv2Client | null | undefined; // undefined = not probed, null = not configured

function getSesClient(): SESv2Client | null {
  if (cachedClient !== undefined) return cachedClient;
  const region = process.env.AWS_REGION;
  const from = process.env.SES_FROM_EMAIL;
  if (!region || !from) {
    cachedClient = null;
    return null;
  }
  // Credentials resolve via the default chain — no explicit args required.
  cachedClient = new SESv2Client({ region });
  return cachedClient;
}

function fromAddress(): string {
  return process.env.SES_FROM_EMAIL ?? "";
}

function configurationSet(): string | undefined {
  const v = process.env.SES_CONFIGURATION_SET;
  return v && v.trim() ? v.trim() : undefined;
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
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer;
    contentType?: string;
  }>;
}): Promise<SendResult> {
  const client = getSesClient();
  if (!client) {
    return {
      sent: false,
      reason: "SES not configured (set AWS_REGION + SES_FROM_EMAIL in backend/.env)",
    };
  }
  if (args.to.length === 0) return { sent: false, reason: "no recipients" };

  try {
    const hasAttachments = (args.attachments?.length ?? 0) > 0;

    // SES v2 supports two content shapes:
    //   Simple — text + html only, SES handles all encoding (cheap path)
    //   Raw    — full MIME blob, required for attachments (Audit HTML report)
    const command = hasAttachments
      ? new SendEmailCommand({
          FromEmailAddress: fromAddress(),
          Destination: { ToAddresses: args.to },
          Content: { Raw: { Data: await buildRawMime(args) } },
          ConfigurationSetName: configurationSet(),
        })
      : new SendEmailCommand({
          FromEmailAddress: fromAddress(),
          Destination: { ToAddresses: args.to },
          Content: {
            Simple: {
              Subject: { Data: args.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: args.text, Charset: "UTF-8" },
                ...(args.html
                  ? { Html: { Data: args.html, Charset: "UTF-8" } }
                  : {}),
              },
            },
          },
          ConfigurationSetName: configurationSet(),
        });

    await client.send(command);
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[email] SES send failed:", msg);
    return { sent: false, reason: msg };
  }
}

// ---------- Raw MIME builder (only used when there are attachments) --------
//
// Builds a multipart/mixed message:
//   multipart/mixed
//     multipart/alternative (text/plain + text/html)
//     attachment 1
//     attachment 2
//     ...
//
// All parts base64-encoded for safety against long lines / non-ASCII content.
// Lines are CRLF-terminated per RFC 5322.

async function buildRawMime(args: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer;
    contentType?: string;
  }>;
}): Promise<Uint8Array> {
  const CRLF = "\r\n";
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const mixedBoundary = `MIX_${stamp}`;
  const altBoundary = `ALT_${stamp}`;
  const lines: string[] = [];

  // Headers
  lines.push(`From: ${fromAddress()}`);
  lines.push(`To: ${args.to.join(", ")}`);
  lines.push(`Subject: ${encodeHeaderValue(args.subject)}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  lines.push("");

  // ---- Body part: alternative(text, html) ----
  lines.push(`--${mixedBoundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  lines.push("");

  lines.push(`--${altBoundary}`);
  lines.push("Content-Type: text/plain; charset=UTF-8");
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(base64Wrap(Buffer.from(args.text, "utf-8")));
  lines.push("");

  if (args.html) {
    lines.push(`--${altBoundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(base64Wrap(Buffer.from(args.html, "utf-8")));
    lines.push("");
  }

  lines.push(`--${altBoundary}--`);
  lines.push("");

  // ---- Attachments ----
  for (const att of args.attachments ?? []) {
    // Prefer in-memory bytes (reports now come from S3, not a local path); fall
    // back to reading a local file path for any other attachment source.
    const data = att.content ?? (att.path ? await readFile(att.path) : Buffer.alloc(0));
    const ctype = att.contentType ?? "application/octet-stream";
    const safeName = att.filename.replace(/"/g, "");
    lines.push(`--${mixedBoundary}`);
    lines.push(`Content-Type: ${ctype}; name="${safeName}"`);
    lines.push(`Content-Disposition: attachment; filename="${safeName}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(base64Wrap(data));
    lines.push("");
  }

  lines.push(`--${mixedBoundary}--`);
  lines.push("");

  return Buffer.from(lines.join(CRLF), "utf-8");
}

/** Wrap a base64 string into 76-char lines per RFC 2045. */
function base64Wrap(buf: Buffer): string {
  const b64 = buf.toString("base64");
  // Insert CRLF every 76 chars (the canonical base64 line length for MIME).
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/** RFC 2047 encoded-word for non-ASCII headers (used for Subject). */
function encodeHeaderValue(s: string): string {
  // ASCII-only: emit as-is (still good).
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`;
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
  url: MonitoredUrl,
  recipientsOverride?: string
): Promise<SendResult> {
  const to = parseRecipients(recipientsOverride ?? project.notificationEmails);
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
  failedStep: FlowStep | null = null,
  recipientsOverride?: string
): Promise<SendResult> {
  const to = parseRecipients(recipientsOverride ?? project.notificationEmails);
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
  reportBytes: Buffer;
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
    reportBytes,
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
        content: reportBytes,
        contentType: "text/html",
      },
    ],
  });
}
