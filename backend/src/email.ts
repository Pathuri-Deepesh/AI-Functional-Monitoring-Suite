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
      attachments: args.attachments,
    });
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[email] sendMail failed:", msg);
    return { sent: false, reason: msg };
  }
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

  const lines = [
    `📊 Audit report — ${project.name}`,
    ``,
    `${totalOk} healthy · ${totalFailing} failing · ${total} total`,
    `🔗 URLs: ${okUrls} OK · ${failingUrls} failing (of ${urls.length})`,
    flowSummaries.length > 0
      ? `📋 Flows: ${okFlows} OK · ${failingFlows} failing (of ${flowSummaries.length})`
      : "",
    reportUrl ? `Report: ${reportUrl}` : "",
    ``,
    `Full HTML report attached.`,
  ]
    .filter((l) => l !== null && l !== undefined)
    .join("\n");

  return sendMail({
    to,
    subject: `[${project.name}] Audit report — ${totalOk} OK, ${totalFailing} failing`,
    text: lines,
    attachments: [
      {
        filename: reportFilename,
        path: reportPath,
        contentType: "text/html",
      },
    ],
  });
}
