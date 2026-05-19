import type { UrlStats } from "../types";

interface Props {
  stats: UrlStats | null;
}

export function FailureChip({ stats }: Props) {
  if (!stats || stats.total === 0) {
    return (
      <span className="failure-chip neutral" title="No checks yet">
        — no data
      </span>
    );
  }
  const rate = stats.failureRatePct;
  const tone = rate > 5 ? "bad" : rate > 1 ? "warn" : "good";
  return (
    <span
      className={`failure-chip ${tone}`}
      title={`${stats.failures} failures out of ${stats.total} checks in last 24h`}
    >
      {tone === "good" ? "✓" : tone === "warn" ? "⚠" : "🔴"} {rate.toFixed(1)}% fail (24h)
    </span>
  );
}
