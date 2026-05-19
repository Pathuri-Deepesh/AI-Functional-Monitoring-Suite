import { useMemo } from "react";
import { Sparkline } from "./Sparkline";
import type { Flow, MonitoredUrl, SparklinePoint } from "../types";

function formatTrendLabel(windowMinutes: number): string {
  const days = windowMinutes / (60 * 24);
  if (days <= 1) return `${Math.round(windowMinutes / 60)}h`;
  if (days <= 60) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

interface Props {
  urls: MonitoredUrl[];
  flows?: Flow[];
  sparklineByUrl: Record<string, SparklinePoint[]>;
  windowMinutes?: number;
}

export function KpiBar({ urls, flows = [], sparklineByUrl, windowMinutes = 24 * 60 }: Props) {
  const stats = useMemo(() => {
    // URLs
    const failingUrls = urls.filter(
      (u) => u.statusGroup === "error" || u.statusGroup === "5xx" || u.statusGroup === "4xx"
    ).length;
    const okUrls = urls.length - failingUrls;

    // Flows
    const okFlows = flows.filter((f) => f.lastRunOk === true).length;
    const failingFlows = flows.filter((f) => f.lastRunOk === false).length;

    const totalEntities = urls.length + flows.length;
    const totalHealthy = okUrls + okFlows;
    const totalFailing = failingUrls + failingFlows;
    const healthyPct = totalEntities > 0 ? (totalHealthy / totalEntities) * 100 : 100;

    // URL latency only (flows are multi-step, mixing is misleading)
    const latencies = urls
      .map((u) => u.timings?.totalMs)
      .filter((x): x is number => x != null && x > 0);
    const avgLatency =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;

    return {
      urlsCount: urls.length,
      flowsCount: flows.length,
      totalEntities,
      okUrls,
      failingUrls,
      okFlows,
      failingFlows,
      totalHealthy,
      totalFailing,
      healthyPct,
      avgLatency,
    };
  }, [urls, flows]);

  // Aggregate project-wide latency sparkline (URLs only — flows have their own timeline)
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

  const hasFlows = stats.flowsCount > 0;
  const healthyColor =
    stats.healthyPct >= 95
      ? "var(--g-2xx)"
      : stats.healthyPct >= 80
      ? "var(--g-4xx)"
      : "var(--g-5xx)";
  const failingColor = stats.totalFailing > 0 ? "var(--g-5xx)" : "var(--g-2xx)";

  return (
    <div className="kpi-bar">
      <div className="kpi-card">
        <div className="kpi-num">{stats.totalEntities}</div>
        <div className="kpi-lbl">{hasFlows ? "Endpoints" : "URLs Monitored"}</div>
        {hasFlows && (
          <div className="kpi-breakdown">
            {stats.urlsCount} URLs · {stats.flowsCount} flows
          </div>
        )}
      </div>

      <div className="kpi-card">
        <div className="kpi-num" style={{ color: healthyColor }}>
          {stats.healthyPct.toFixed(1)}%
        </div>
        <div className="kpi-lbl">Currently Healthy</div>
        {hasFlows && (
          <div className="kpi-breakdown">
            {stats.okUrls} URLs · {stats.okFlows} flows
          </div>
        )}
      </div>

      <div className="kpi-card">
        <div className="kpi-num">
          {stats.avgLatency != null ? `${stats.avgLatency}` : "—"}
          <span className="kpi-unit">ms</span>
        </div>
        <div className="kpi-lbl">Avg URL Latency</div>
        {hasFlows && <div className="kpi-breakdown">flows tracked separately</div>}
      </div>

      <div className="kpi-card">
        <div className="kpi-num" style={{ color: failingColor }}>
          {stats.totalFailing}
        </div>
        <div className="kpi-lbl">Currently Failing</div>
        {hasFlows && (
          <div className="kpi-breakdown">
            {stats.failingUrls} URLs · {stats.failingFlows} flows
          </div>
        )}
      </div>

      <div className="kpi-card kpi-card-spark">
        <div className="kpi-spark-wrap">
          <Sparkline points={projectSparkline} width={200} height={40} />
        </div>
        <div className="kpi-lbl">URL trend ({formatTrendLabel(windowMinutes)})</div>
      </div>
    </div>
  );
}
