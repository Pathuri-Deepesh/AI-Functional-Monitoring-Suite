import type { MonitoredUrl, Project, UrlStats } from "./types.js";

interface RenderArgs {
  project: Project;
  urls: MonitoredUrl[];
  stats: Record<string, UrlStats>;
  sparklines: Record<string, number[]>;
}

const COLORS = {
  bg: "#0a0e15",
  panel: "#131922",
  border: "#262f3e",
  text: "#e2e8f0",
  muted: "#94a3b8",
  g2xx: "#10b981",
  g3xx: "#06b6d4",
  g4xx: "#f59e0b",
  g5xx: "#ef4444",
  gerr: "#6b7280",
};

export function renderReportHtml(args: RenderArgs): string {
  const { project, urls, stats, sparklines } = args;
  const failing = urls.filter(
    (u) => u.statusGroup === "5xx" || u.statusGroup === "error" || u.statusGroup === "4xx"
  );
  const ok = urls.length - failing.length;
  const generatedAt = new Date().toLocaleString();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Audit — ${escapeHtml(project.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: ${COLORS.bg}; color: ${COLORS.text}; padding: 32px; }
  .container { max-width: 1100px; margin: 0 auto; }
  header { margin-bottom: 24px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  .sub { color: ${COLORS.muted}; font-size: 14px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0; }
  .kpi { background: ${COLORS.panel}; border: 1px solid ${COLORS.border}; border-radius: 12px; padding: 16px; }
  .kpi-num { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
  .kpi-lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: ${COLORS.muted}; }
  table { width: 100%; border-collapse: collapse; background: ${COLORS.panel}; border: 1px solid ${COLORS.border}; border-radius: 12px; overflow: hidden; }
  th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid ${COLORS.border}; font-size: 13px; }
  th { background: rgba(255,255,255,0.02); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${COLORS.muted}; }
  tr:last-child td { border-bottom: 0; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; }
  .g-2xx { background: rgba(16,185,129,0.15); color: ${COLORS.g2xx}; }
  .g-3xx { background: rgba(6,182,212,0.15); color: ${COLORS.g3xx}; }
  .g-4xx { background: rgba(245,158,11,0.15); color: ${COLORS.g4xx}; }
  .g-5xx { background: rgba(239,68,68,0.15); color: ${COLORS.g5xx}; }
  .g-error { background: rgba(107,114,128,0.15); color: ${COLORS.gerr}; }
  .url { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; word-break: break-all; }
  .method { display:inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; margin-right: 6px; background: rgba(255,255,255,0.05); }
  .reason { color: ${COLORS.g5xx}; font-size: 12px; margin-top: 4px; }
  .spark { fill: none; stroke: ${COLORS.g2xx}; stroke-width: 1.5; }
  .spark-bg { stroke: ${COLORS.border}; stroke-width: 1; opacity: 0.5; }
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
    <div class="kpi"><div class="kpi-num">${urls.length}</div><div class="kpi-lbl">Endpoints checked</div></div>
    <div class="kpi"><div class="kpi-num" style="color:${COLORS.g2xx}">${ok}</div><div class="kpi-lbl">Healthy</div></div>
    <div class="kpi"><div class="kpi-num" style="color:${COLORS.g5xx}">${failing.length}</div><div class="kpi-lbl">Failing</div></div>
    <div class="kpi"><div class="kpi-num">${avgFailureRate(urls, stats).toFixed(1)}%</div><div class="kpi-lbl">Failure rate (24h)</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Endpoint</th>
        <th>Status</th>
        <th>Latency (now)</th>
        <th>24h Failure %</th>
        <th>24h Trend</th>
      </tr>
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
  </table>

  <footer>Functional Monitoring Suite · Phase 1.5 audit · 24h history window</footer>
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
