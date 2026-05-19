import type { CheckRecord } from "../types";

interface Props {
  history: CheckRecord[];
  windowMinutes?: number;
  buckets?: number;
}

/**
 * GitHub-commit-graph-style 24h status strip.
 * Each cell is one time bucket; color reflects worst result in that bucket.
 */
export function StatusStrip({ history, windowMinutes = 24 * 60, buckets = 60 }: Props) {
  const now = Date.now();
  const since = now - windowMinutes * 60_000;
  const bucketWidthMs = (windowMinutes * 60_000) / buckets;
  const cells: ("ok" | "warn" | "fail" | "empty")[] = Array(buckets).fill("empty");

  for (const c of history) {
    if (c.checkedAt < since) continue;
    const idx = Math.min(buckets - 1, Math.floor((c.checkedAt - since) / bucketWidthMs));
    const cur = cells[idx];
    const next: typeof cur = c.ok
      ? "ok"
      : c.statusGroup === "5xx" || c.statusGroup === "error"
      ? "fail"
      : "warn";
    // worst wins
    const rank = { empty: 0, ok: 1, warn: 2, fail: 3 } as const;
    if (rank[next] > rank[cur]) cells[idx] = next;
  }

  return (
    <div className="status-strip" title={`Last ${windowMinutes / 60}h status`}>
      {cells.map((c, i) => (
        <span key={i} className={`status-cell strip-${c}`} />
      ))}
    </div>
  );
}
