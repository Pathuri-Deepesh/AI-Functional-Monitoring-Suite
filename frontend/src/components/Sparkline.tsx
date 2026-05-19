import type { SparklinePoint } from "../types";

interface Props {
  points: SparklinePoint[];
  width?: number;
  height?: number;
  showAxis?: boolean;
}

export function Sparkline({ points, width = 200, height = 40, showAxis = false }: Props) {
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

  // Failure markers
  const failureDots = points
    .map((p, i) => {
      if (p.failures === 0) return null;
      const x = i * step;
      return <circle key={i} cx={x} cy={height - 3} r={2.2} fill="var(--g-5xx)" />;
    })
    .filter(Boolean);

  return (
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
      {showAxis && (
        <text x={width - 2} y={10} fontSize="9" fill="var(--muted)" textAnchor="end">
          {max}ms
        </text>
      )}
    </svg>
  );
}
