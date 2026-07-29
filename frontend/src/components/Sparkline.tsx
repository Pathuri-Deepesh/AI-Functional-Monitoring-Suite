import { useRef, useState } from "react";
import type { SparklinePoint } from "../types";
import { formatLatency } from "../utils/format";

interface Props {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  showAxis?: boolean;
}

/** "3 min ago" / "5 hr ago" / a date for older buckets. */
function formatBucketAgo(bucketStart: number): string {
  const ago = (Date.now() - bucketStart) / 60_000; // minutes
  if (ago < 1) return "just now";
  if (ago < 60) return `${Math.round(ago)} min ago`;
  if (ago < 60 * 24) return `${Math.round(ago / 60)} hr ago`;
  return new Date(bucketStart).toLocaleString();
}

export function Sparkline({ points, width = 200, height = 40, showAxis = false }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const valid = points.filter((p) => p.avgLatencyMs != null && p.total > 0);
  if (valid.length < 2) {
    return (
      <div className="sparkline-empty" style={{ width, height }}>
        <span>Not enough data yet</span>
      </div>
    );
  }

  const values = points.map((p) => p.avgLatencyMs ?? 0);
  const max = Math.max(...values, 1);
  const step = width / Math.max(1, points.length - 1);

  // Build polyline points (skip empty buckets by leaving gaps)
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    const x = i * step;
    if (p.avgLatencyMs == null || p.total === 0) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    const y = height - (p.avgLatencyMs / max) * (height - 4) - 2;
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  // Build gradient fill area (only for the first/main segment for clarity)
  const firstSeg = segments[0];
  const fillPath = firstSeg
    ? `M ${firstSeg.split(" ")[0]} L ${firstSeg.split(" ").join(" L ")} L ${(values.length - 1) * step},${height} L 0,${height} Z`
    : "";

  // Failure markers — red dots on buckets that had at least one failure.
  const failureDots = points
    .map((p, i) => {
      if (p.failures === 0) return null;
      const x = i * step;
      return (
        <circle
          key={i}
          cx={x}
          cy={height - 3}
          r={hoverIdx === i ? 3.2 : 2.2}
          fill="var(--g-5xx)"
        />
      );
    })
    .filter(Boolean);

  // ---- Hover: map cursor x → nearest bucket index. ----
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(frac * (points.length - 1))));
    setHoverIdx(idx);
  };

  const hovered = hoverIdx != null ? points[hoverIdx] : null;
  const hoveredHealthy = hovered ? Math.max(0, hovered.total - hovered.failures) : 0;
  // Position the tooltip over the hovered bucket; clamp so it doesn't clip at edges.
  const rawPct = hoverIdx != null ? (hoverIdx / Math.max(1, points.length - 1)) * 100 : 0;
  const tipPct = Math.min(85, Math.max(15, rawPct));
  const hoveredX = hoverIdx != null ? hoverIdx * step : 0;
  const hoveredY =
    hovered && hovered.avgLatencyMs != null
      ? height - (hovered.avgLatencyMs / max) * (height - 4) - 2
      : null;

  return (
    <div
      className="sparkline-wrap"
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="sparkline"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--g-2xx)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--g-2xx)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {fillPath && <path d={fillPath} fill="url(#sparkfill)" />}
        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg}
            fill="none"
            stroke="var(--g-2xx)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {failureDots}
        {/* Hover guide line + marker on the latency point under the cursor. */}
        {hoverIdx != null && (
          <line
            x1={hoveredX}
            y1={0}
            x2={hoveredX}
            y2={height}
            stroke="var(--muted)"
            strokeWidth="0.6"
            strokeDasharray="2 2"
            opacity="0.6"
          />
        )}
        {hoveredY != null && (
          <circle cx={hoveredX} cy={hoveredY} r={2.6} fill="var(--g-2xx)" stroke="var(--bg)" strokeWidth="1" />
        )}
        {showAxis && (
          <text x={width - 2} y={10} fontSize="9" fill="var(--muted)" textAnchor="end">
            <title>{`${max}ms`}</title>
            {formatLatency(max)}
          </text>
        )}
      </svg>

      {hovered && (
        <div className="spark-tip" style={{ left: `${tipPct}%` }}>
          <div className="st-time">{formatBucketAgo(hovered.bucketStart)}</div>
          {hovered.total === 0 ? (
            <div className="st-empty">No checks in this window</div>
          ) : (
            <>
              <div className="st-row">
                <span className="st-dot ok" /> Healthy
                <b>{hoveredHealthy}</b>
              </div>
              <div className="st-row">
                <span className="st-dot fail" /> Failed
                <b className={hovered.failures > 0 ? "bad" : ""}>{hovered.failures}</b>
              </div>
              {hovered.avgLatencyMs != null && (
                <div className="st-row muted">
                  Avg latency
                  <b title={`${hovered.avgLatencyMs}ms`}>{formatLatency(hovered.avgLatencyMs)}</b>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
