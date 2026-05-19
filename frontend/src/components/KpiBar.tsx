import { useMemo } from "react";
import { Sparkline } from "./Sparkline";
import type { MonitoredUrl, SparklinePoint } from "../types";

function formatTrendLabel(windowMinutes: number): string {
  const days = windowMinutes / (60 * 24);
  if (days <= 1) return `${Math.round(windowMinutes / 60)}h`;
  if (days <= 60) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

interface Props {
  urls: MonitoredUrl[];
  sparklineByUrl: Record<string, SparklinePoint[]>;
  windowMinutes?: number;
}

export function KpiBar({ urls, sparklineByUrl, windowMinutes = 24 * 60 }: Props) {
  const stats = useMemo(() => {
    const total = urls.length;
    const failing = urls.filter(
      (u) => u.statusGroup === "error" || u.statusGroup === "5xx" || u.statusGroup === "4xx"
    ).length;
    const okPct = total > 0 ? ((total - failing) / total) * 100 : 100;

    const latencies = urls
      .map((u) => u.timings?.totalMs)
      .filter((x): x is number => x != null && x > 0);
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

    return { total, failing, okPct, avgLatency };
  }, [urls]);

  // Aggregate project-wide failure-over-time sparkline by summing failures per bucket
  const projectSparkline: SparklinePoint[] = useMemo(() => {
    const allSeries = Object.values(sparklineByUrl);
    if (allSeries.length === 0) return [];
    const buckets = allSeries[0].length;
    const out: SparklinePoint[] = [];
    for (let i = 0; i < buckets; i++) {
      let bucketStart = 0;
      let totalChecks = 0;
      let totalFailures = 0;
      let latencySum = 0;
      let latencyCount = 0;
      for (const series of allSeries) {
        const p = series[i];
        if (!p) continue;
        bucketStart = p.bucketStart;
        totalChecks += p.total;
        totalFailures += p.failures;
        if (p.avgLatencyMs != null && p.total > 0) {
          latencySum += p.avgLatencyMs * p.total;
          latencyCount += p.total;
        }
      }
      out.push({
        bucketStart,
        avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
        failures: totalFailures,
        total: totalChecks,
      });
    }
    return out;
  }, [sparklineByUrl]);

  return (
    <div className="kpi-bar">
      <div className="kpi-card">
        <div className="kpi-num">{stats.total}</div>
        <div className="kpi-lbl">URLs Monitored</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-num" style={{ color: stats.okPct >= 95 ? "var(--g-2xx)" : stats.okPct >= 80 ? "var(--g-4xx)" : "var(--g-5xx)" }}>
          {stats.okPct.toFixed(1)}%
        </div>
        <div className="kpi-lbl">Currently Healthy</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-num">{stats.avgLatency != null ? `${stats.avgLatency}` : "—"}<span className="kpi-unit">ms</span></div>
        <div className="kpi-lbl">Avg latency</div>
      </div>
      <div className="kpi-card">
        <div className="kpi-num" style={{ color: stats.failing > 0 ? "var(--g-5xx)" : "var(--g-2xx)" }}>
          {stats.failing}
        </div>
        <div className="kpi-lbl">Currently Failing</div>
      </div>
      <div className="kpi-card kpi-card-spark">
        <div className="kpi-spark-wrap">
          <Sparkline points={projectSparkline} width={200} height={40} />
        </div>
        <div className="kpi-lbl">Project trend ({formatTrendLabel(windowMinutes)})</div>
      </div>
    </div>
  );
}
