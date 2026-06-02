// Display formatters shared across cards / timelines / KPIs.
// Goal: numbers that are easy to glance at, not raw machine output.

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 0) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export function formatRelative(ts: number | string | Date | null | undefined, now: number = Date.now()): string {
  if (ts == null) return "—";
  const t = ts instanceof Date ? ts.getTime() : typeof ts === "string" ? Date.parse(ts) : ts;
  if (!Number.isFinite(t)) return "—";
  const diff = now - t;
  const abs = Math.abs(diff);
  const future = diff < 0;

  const sec = Math.round(abs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return future ? `in ${sec}s` : `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return future ? `in ${min} min` : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return future ? `in ${hr}h` : `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return future ? `in ${day}d` : `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return future ? `in ${mo}mo` : `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return future ? `in ${yr}y` : `${yr}y ago`;
}

export function formatAbsolute(ts: number | string | Date | null | undefined): string {
  if (ts == null) return "—";
  const t = ts instanceof Date ? ts : typeof ts === "string" ? new Date(Date.parse(ts)) : new Date(ts);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleString();
}
