import type { Flow, FlowRun, MonitoredUrl, Project, UrlStats } from "./types.js";

interface RenderArgs {
  project: Project;
  urls: MonitoredUrl[];
  stats: Record<string, UrlStats>;
  sparklines: Record<string, number[]>;
  flowSummaries: Array<{ flow: Flow; latestRun: FlowRun | null }>;
}

const COLORS = {
  bg: "#0a0e15",
  panel: "#131922",
  panel2: "#1a212d",
  border: "#262f3e",
  text: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#3b82f6",
  g2xx: "#10b981",
  g3xx: "#06b6d4",
  g4xx: "#f59e0b",
  g5xx: "#ef4444",
  gerr: "#6b7280",
};

export function renderReportHtml(args: RenderArgs): string {
  const { project, urls, stats, sparklines, flowSummaries } = args;
  const failingUrls = urls.filter(
    (u) => u.statusGroup === "5xx" || u.statusGroup === "error" || u.statusGroup === "4xx"
  );
  const okUrls = urls.length - failingUrls.length;
  const failingFlows = flowSummaries.filter((s) => s.latestRun?.ok === false);
  const okFlows = flowSummaries.filter((s) => s.latestRun?.ok === true).length;
  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Audit — ${escapeHtml(project.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: ${COLORS.bg}; color: ${COLORS.text}; padding: 32px; line-height: 1.5; }
  .container { max-width: 1100px; margin: 0 auto; }
  header { margin-bottom: 24px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  h2 { margin: 32px 0 12px; font-size: 18px; color: ${COLORS.text}; display: flex; align-items: center; gap: 8px; }
  h2 .count { font-size: 12px; background: ${COLORS.panel2}; color: ${COLORS.muted}; padding: 2px 8px; border-radius: 999px; border: 1px solid ${COLORS.border}; font-family: ui-monospace, monospace; }
  .sub { color: ${COLORS.muted}; font-size: 13px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
  .kpi { background: ${COLORS.panel}; border: 1px solid ${COLORS.border}; border-radius: 12px; padding: 16px; }
  .kpi-num { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
  .kpi-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${COLORS.muted}; }
  .breakdown { font-size: 11px; color: ${COLORS.muted}; margin-top: 6px; font-family: ui-monospace, monospace; }
  table { width: 100%; border-collapse: collapse; background: ${COLORS.panel}; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden; }
  th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid ${COLORS.border}; font-size: 13px; vertical-align: top; }
  th { background: rgba(255,255,255,0.02); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${COLORS.muted}; }
  tr:last-child td { border-bottom: 0; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; }
  .g-2xx { background: rgba(16,185,129,0.15); color: ${COLORS.g2xx}; }
  .g-3xx { background: rgba(6,182,212,0.15); color: ${COLORS.g3xx}; }
  .g-4xx { background: rgba(245,158,11,0.15); color: ${COLORS.g4xx}; }
  .g-5xx { background: rgba(239,68,68,0.15); color: ${COLORS.g5xx}; }
  .g-error { background: rgba(107,114,128,0.15); color: ${COLORS.gerr}; }
  .g-ok { background: rgba(16,185,129,0.15); color: ${COLORS.g2xx}; }
  .g-fail { background: rgba(239,68,68,0.15); color: ${COLORS.g5xx}; }
  .g-none { background: rgba(148,163,184,0.15); color: ${COLORS.muted}; }
  .url, .flow-name { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; word-break: break-all; }
  .method { display:inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-right: 6px; background: rgba(255,255,255,0.05); }
  .reason { color: ${COLORS.g5xx}; font-size: 12px; margin-top: 4px; }
  .spark { fill: none; stroke: ${COLORS.g2xx}; stroke-width: 1.5; }
  .step-line { font-size: 11px; color: ${COLORS.muted}; padding: 4px 0; display: flex; gap: 8px; align-items: center; border-top: 1px dashed ${COLORS.border}; }
  .step-line:first-child { border-top: 0; }
  .step-num { display: inline-block; min-width: 20px; height: 20px; line-height: 20px; text-align: center; background: ${COLORS.panel2}; border-radius: 50%; font-weight: 700; font-size: 10px; color: ${COLORS.muted}; font-family: ui-monospace, monospace; }
  .empty-section { text-align: center; color: ${COLORS.muted}; padding: 32px; background: ${COLORS.panel}; border: 1px dashed ${COLORS.border}; border-radius: 12px; }
  footer { margin-top: 32px; color: ${COLORS.muted}; font-size: 12px; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>${escapeHtml(project.name)} — Audit Report</h1>
    <div class="sub">${escapeHtml(project.description || "")}</div>
    <div class="sub">Generated ${escapeHtml(generatedAt)}</div>
  </header>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-num">${urls.length + flowSummaries.length}</div>
      <div class="kpi-lbl">Endpoints checked</div>
      <div class="breakdown">${urls.length} URLs · ${flowSummaries.length} flows</div>
    </div>
    <div class="kpi">
      <div class="kpi-num" style="color:${COLORS.g2xx}">${okUrls + okFlows}</div>
      <div class="kpi-lbl">Healthy</div>
      <div class="breakdown">${okUrls} URLs · ${okFlows} flows</div>
    </div>
    <div class="kpi">
      <div class="kpi-num" style="color:${failingUrls.length + failingFlows.length > 0 ? COLORS.g5xx : COLORS.g2xx}">${failingUrls.length + failingFlows.length}</div>
      <div class="kpi-lbl">Failing</div>
      <div class="breakdown">${failingUrls.length} URLs · ${failingFlows.length} flows</div>
    </div>
    <div class="kpi">
      <div class="kpi-num">${avgFailureRate(urls, stats).toFixed(1)}%</div>
      <div class="kpi-lbl">URL failure rate (24h)</div>
    </div>
  </div>

  <h2>🔗 Standalone URLs <span class="count">${urls.length}</span></h2>
  ${urls.length === 0 ? `<div class="empty-section">No standalone URLs in this project.</div>` : `
  <table>
    <thead>
      <tr><th>Endpoint</th><th>Status</th><th>Latency (now)</th><th>24h Failure %</th><th>24h Trend</th></tr>
    </thead>
    <tbody>
      ${urls
        .map((u) => {
          const s = stats[u.id];
          const sp = sparklines[u.id] ?? [];
          return `
      <tr>
        <td>
          <div><span class="method">${escapeHtml(u.method)}</span><span class="url">${escapeHtml(u.url)}</span></div>
          ${u.description ? `<div class="sub">${escapeHtml(u.description)}</div>` : ""}
          ${u.errorReason ? `<div class="reason">${escapeHtml(u.errorReason)}</div>` : ""}
        </td>
        <td>${statusPill(u)}</td>
        <td>${u.timings?.totalMs != null ? `${u.timings.totalMs} ms` : "—"}</td>
        <td>${s ? `${s.failureRatePct}% (${s.failures}/${s.total})` : "—"}</td>
        <td>${sparkline(sp)}</td>
      </tr>`;
        })
        .join("")}
    </tbody>
  </table>`}

  <h2>📋 Flows <span class="count">${flowSummaries.length}</span></h2>
  ${flowSummaries.length === 0 ? `<div class="empty-section">No flows defined in this project.</div>` : `
  <table>
    <thead>
      <tr><th>Flow</th><th>Status</th><th>Last run</th><th>Steps</th><th>Schedule</th></tr>
    </thead>
    <tbody>
      ${flowSummaries
        .map(({ flow, latestRun }) => {
          const statusLabel = latestRun == null ? "NEVER RUN" : latestRun.ok ? "OK" : "FAILED";
          const statusClass = latestRun == null ? "g-none" : latestRun.ok ? "g-ok" : "g-fail";
          const totalMs = latestRun?.totalMs;
          const startedAt = latestRun ? new Date(latestRun.startedAt).toLocaleString() : "—";
          const stepCount = latestRun ? latestRun.stepResults.length : 0;
          const okSteps = latestRun ? latestRun.stepResults.filter((sr) => sr.ok || sr.skipped).length : 0;
          const failedStep = latestRun ? latestRun.stepResults.find((sr) => !sr.ok && !sr.skipped) : null;
          return `
      <tr>
        <td>
          <div class="flow-name"><strong>${escapeHtml(flow.name)}</strong></div>
          ${flow.description ? `<div class="sub">${escapeHtml(flow.description)}</div>` : ""}
          ${failedStep && failedStep.errorReason ? `<div class="reason">Failed at step ${failedStep.position}: ${escapeHtml(failedStep.errorReason)}</div>` : ""}
          ${latestRun && latestRun.stepResults.length > 0 ? `
            <div style="margin-top:8px">
              ${latestRun.stepResults.slice(0, 6).map((sr) => {
                const cls = sr.skipped ? "g-none" : sr.ok ? "g-ok" : "g-fail";
                const lbl = sr.skipped ? "—" : sr.statusCode ?? "?";
                return `<span class="step-line"><span class="step-num">${sr.position}</span><span class="pill ${cls}">${lbl}</span><span>${sr.timings.totalMs != null ? sr.timings.totalMs + "ms" : ""}</span>${sr.skipped ? '<span style="color:' + COLORS.muted + '">skipped</span>' : ""}</span>`;
              }).join("")}
            </div>` : ""}
        </td>
        <td>${`<span class="pill ${statusClass}">${statusLabel}</span>`}</td>
        <td>${totalMs != null ? `${totalMs} ms` : "—"}<div class="sub" style="font-size:11px">${startedAt}</div></td>
        <td>${stepCount > 0 ? `${okSteps}/${stepCount}` : "—"}</td>
        <td><div class="sub">Every ${flow.intervalMinutes} min</div><div class="sub" style="font-size:11px">${flow.stopOnFailure ? "Stop on fail" : "Continue on fail"}${flow.enabled ? "" : " · DISABLED"}</div></td>
      </tr>`;
        })
        .join("")}
    </tbody>
  </table>`}

  <footer>Functional Monitoring Suite · 24h history window · ${escapeHtml(generatedAt)}</footer>
</div>
</body>
</html>`;
}

function statusPill(u: MonitoredUrl): string {
  if (!u.statusGroup) return `<span class="pill">PENDING</span>`;
  const code = u.statusCode ? ` · ${u.statusCode}` : "";
  return `<span class="pill g-${u.statusGroup}">${u.statusGroup.toUpperCase()}${code}</span>`;
}

function sparkline(values: number[]): string {
  if (values.length === 0) return `<span style="color:${COLORS.muted}">no data</span>`;
  const w = 120;
  const h = 24;
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><polyline class="spark" points="${points}" /></svg>`;
}

function avgFailureRate(urls: MonitoredUrl[], stats: Record<string, UrlStats>): number {
  if (urls.length === 0) return 0;
  const sum = urls.reduce((acc, u) => acc + (stats[u.id]?.failureRatePct ?? 0), 0);
  return sum / urls.length;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
