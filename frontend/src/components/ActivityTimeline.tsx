import { useMemo, useState } from "react";
import type { CheckRecord } from "../types";

interface Props {
  history: CheckRecord[];
  windowMinutes?: number;
  buckets?: number;
}

interface Bucket {
  start: number;
  end: number;
  count: number;
  failures: number;
  warns: number;
  avgLatencyMs: number;
  status: "ok" | "warn" | "fail" | "empty";
}

function formatWindow(windowMinutes: number): string {
  const hours = windowMinutes / 60;
  const days = windowMinutes / (60 * 24);
  if (hours <= 48) return `last ${Math.round(hours)}h`;
  if (days <= 60) return `last ${Math.round(days)}d`;
  return `last ${Math.round(days / 30)} months`;
}

function buildAxisLabels(windowMinutes: number): string[] {
  const days = windowMinutes / (60 * 24);
  if (days <= 1) {
    const h = Math.round(windowMinutes / 60);
    return [`${h}h ago`, `${Math.round(h * 0.75)}h`, `${Math.round(h * 0.5)}h`, `${Math.round(h * 0.25)}h`, "now"];
  }
  if (days <= 60) {
    const d = Math.round(days);
    return [`${d}d ago`, `${Math.round(d * 0.75)}d`, `${Math.round(d * 0.5)}d`, `${Math.round(d * 0.25)}d`, "now"];
  }
  const now = Date.now();
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return [
    fmt(now - windowMinutes * 60_000),
    fmt(now - windowMinutes * 60_000 * 0.75),
    fmt(now - windowMinutes * 60_000 * 0.5),
    fmt(now - windowMinutes * 60_000 * 0.25),
    "now",
  ];
}

/**
 * Unified activity viz: per-bucket vertical bars where height = avg latency
 * and color = status. Replaces the older "status strip + line sparkline".
 */
export function ActivityTimeline({ history, windowMinutes = 24 * 60, buckets = 60 }: Props) {
  const [hover, setHover] = useState<{ idx: number; x: number; y: number } | null>(null);
  const now = Date.now();
  const since = now - windowMinutes * 60_000;
  const bucketMs = (windowMinutes * 60_000) / buckets;

  const data: Bucket[] = useMemo(() => {
    const out: Bucket[] = Array.from({ length: buckets }, (_, i) => ({
      start: since + i * bucketMs,
      end: since + (i + 1) * bucketMs,
      count: 0,
      failures: 0,
      warns: 0,
      avgLatencyMs: 0,
      status: "empty",
    }));
    const sums = new Array(buckets).fill(0);
    const counts = new Array(buckets).fill(0);
    for (const c of history) {
      if (c.checkedAt < since) continue;
      const idx = Math.min(buckets - 1, Math.floor((c.checkedAt - since) / bucketMs));
      const b = out[idx];
      b.count++;
      if (!c.ok) {
        if (c.statusGroup === "5xx" || c.statusGroup === "error") b.failures++;
        else b.warns++;
      }
      const t = c.timings?.totalMs;
      if (t != null) {
        sums[idx] += t;
        counts[idx] += 1;
      }
    }
    for (let i = 0; i < buckets; i++) {
      if (counts[i] > 0) out[i].avgLatencyMs = Math.round(sums[i] / counts[i]);
      const b = out[i];
      if (b.count === 0) b.status = "empty";
      else if (b.failures > 0) b.status = "fail";
      else if (b.warns > 0) b.status = "warn";
      else b.status = "ok";
    }
    return out;
  }, [history, since, buckets, bucketMs]);

  const maxLatency = useMemo(() => {
    const m = Math.max(...data.map((b) => b.avgLatencyMs));
    return Math.max(m, 100);
  }, [data]);

  const totalChecks = data.reduce((s, b) => s + b.count, 0);
  const totalFailures = data.reduce((s, b) => s + b.failures + b.warns, 0);
  const failureRate = totalChecks > 0 ? (totalFailures / totalChecks) * 100 : 0;

  const tooltip = hover ? data[hover.idx] : null;

  return (
    <div className="timeline">
      <div className="timeline-head">
        <div className="timeline-title">
          <span className="timeline-h">Activity timeline</span>
          <span className="timeline-window">{formatWindow(windowMinutes)}</span>
        </div>
        <div className="timeline-summary">
          <span className="ts-num">{totalChecks}</span>
          <span className="ts-lbl">checks</span>
          <span className="ts-sep">·</span>
          <span className={`ts-num ${totalFailures > 0 ? "bad" : "good"}`}>{totalFailures}</span>
          <span className="ts-lbl">failures</span>
          <span className="ts-sep">·</span>
          <span className={`ts-num ${failureRate > 5 ? "bad" : failureRate > 1 ? "warn" : "good"}`}>
            {failureRate.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="timeline-canvas" onMouseLeave={() => setHover(null)}>
        {data.map((b, i) => {
          const heightPct = b.count === 0 ? 6 : Math.max(8, (b.avgLatencyMs / maxLatency) * 100);
          return (
            <div
              key={i}
              className={`tl-bar tl-${b.status}`}
              style={{ height: `${heightPct}%` }}
              onMouseEnter={(e) => {
                const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setHover({ idx: i, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
              onMouseMove={(e) => {
                const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setHover({ idx: i, x: e.clientX - rect.left, y: e.clientY - rect.top });
              }}
            />
          );
        })}

        {tooltip && (
          <div
            className="tl-tooltip"
            style={{
              left: Math.min(Math.max(hover!.x + 12, 8), 360),
              top: Math.max(hover!.y - 70, 0),
            }}
          >
            <div className="tt-time">{formatBucketTime(tooltip.start, tooltip.end)}</div>
            {tooltip.count === 0 ? (
              <div className="tt-empty">No checks in this window</div>
            ) : (
              <>
                <div className="tt-row">
                  <span className="tt-key">Checks</span>
                  <span className="tt-val">{tooltip.count}</span>
                </div>
                <div className="tt-row">
                  <span className="tt-key">Avg latency</span>
                  <span className="tt-val">{tooltip.avgLatencyMs}ms</span>
                </div>
                {tooltip.failures + tooltip.warns > 0 && (
                  <div className="tt-row">
                    <span className="tt-key">Failures</span>
                    <span className={`tt-val ${tooltip.failures > 0 ? "bad" : "warn"}`}>
                      {tooltip.failures + tooltip.warns}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="timeline-axis">
        {buildAxisLabels(windowMinutes).map((lbl, i) => (
          <span key={i}>{lbl}</span>
        ))}
      </div>
    </div>
  );
}

function formatBucketTime(start: number, end: number): string {
  const ago = (Date.now() - start) / 60_000; // minutes
  if (ago < 60) return `${Math.round(ago)} min ago`;
  if (ago < 60 * 24) return `${Math.round(ago / 60)} hr ago`;
  return new Date(start).toLocaleString();
}
