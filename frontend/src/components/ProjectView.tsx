import { useEffect, useMemo, useRef, useState } from "react";
import { UrlCard } from "./UrlCard";
import { KpiBar } from "./KpiBar";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { fetchSparkline } from "../api";
import type { HttpMethod, MonitoredUrl, Project, SparklinePoint, StatusGroup } from "../types";

const GROUP_ORDER: StatusGroup[] = ["2xx", "3xx", "4xx", "5xx", "error"];
const GROUP_LABEL: Record<StatusGroup, string> = {
  "2xx": "Success",
  "3xx": "Redirect",
  "4xx": "Client Err",
  "5xx": "Server Err",
  error: "Unreachable",
};
const PAGE_SIZE = 8;

interface Props {
  project: Project;
  urls: MonitoredUrl[];
  onAddUrl: () => void;
  onManageKeys: () => void;
  onSettings: () => void;
  onDeleteProject: () => void;
  onRunAudit: () => void;
  auditRunning: boolean;
  onCheckUrl: (id: string) => void | Promise<void>;
  onRemoveUrl: (id: string) => void | Promise<void>;
  refreshTick: number;
}

export function ProjectView(props: Props) {
  const { project, urls, refreshTick } = props;
  const [filter, setFilter] = useState<StatusGroup | "all">("all");
  const [methodFilter, setMethodFilter] = useState<HttpMethod | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [windowMinutes, setWindowMinutes] = useState(24 * 60); // default: 24h
  const [sparklineByUrl, setSparklineByUrl] = useState<Record<string, SparklinePoint[]>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // Method counts for the filter chips
  const methodCounts = useMemo(() => {
    const counts: Record<HttpMethod, number> = { GET: 0, POST: 0, PUT: 0, PATCH: 0 };
    for (const u of urls) counts[u.method] = (counts[u.method] ?? 0) + 1;
    return counts;
  }, [urls]);

  // Keyboard shortcut: "/" focuses the search bar
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(() => {
    const g: Record<StatusGroup, number> = {
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      error: 0,
    };
    for (const u of urls) if (u.statusGroup) g[u.statusGroup]++;
    return g;
  }, [urls]);

  const filteredUrls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return urls.filter((u) => {
      if (filter !== "all" && u.statusGroup !== filter) return false;
      if (methodFilter !== "all" && u.method !== methodFilter) return false;
      if (q) {
        const haystack = `${u.url} ${u.description} ${u.method}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [urls, filter, methodFilter, search]);

  // Reset to page 0 when filter/search changes
  useEffect(() => {
    setPage(0);
  }, [filter, methodFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredUrls.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleUrls = filteredUrls.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Pre-load sparklines for the project KPI bar (one batch on project change/refresh/window change)
  useEffect(() => {
    let cancelled = false;
    Promise.all(urls.map((u) => fetchSparkline(u.id, windowMinutes, 30).then((sp) => [u.id, sp] as const)))
      .then((entries) => {
        if (cancelled) return;
        setSparklineByUrl(Object.fromEntries(entries));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshTick, windowMinutes]);

  return (
    <main className="main">
      <div className="project-hero">
        <div>
          <h1>{project.name}</h1>
          {project.description && <p className="project-sub">{project.description}</p>}
          <div className="hero-meta">
            <span className="meta-chip">
              {urls.length} URL{urls.length === 1 ? "" : "s"} monitored
            </span>
            <span className="meta-chip">
              {project.apiKeys.length} API key{project.apiKeys.length === 1 ? "" : "s"}
            </span>
            {(project.slackBotToken && project.slackChannel) ? (
              <span className="meta-chip success">📊 Audit posts to {project.slackChannel}</span>
            ) : project.slackWebhookUrl ? (
              <span className="meta-chip success">🔔 Slack alerts on (webhook)</span>
            ) : (
              <span className="meta-chip muted">🔕 Slack off</span>
            )}
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="primary"
            onClick={props.onRunAudit}
            disabled={props.auditRunning || urls.length === 0}
            title={
              urls.length === 0
                ? "Add at least one URL first"
                : "Re-check every URL and post a report to Slack"
            }
          >
            {props.auditRunning ? "Running audit…" : "🚀 Run audit"}
          </button>
          <button className="ghost" onClick={props.onSettings} title="Project settings">
            ⚙
          </button>
          <button className="ghost destructive" onClick={props.onDeleteProject} title="Delete project">
            🗑
          </button>
        </div>
      </div>

      <TimeRangeSelector value={windowMinutes} onChange={setWindowMinutes} />

      <KpiBar urls={urls} sparklineByUrl={sparklineByUrl} windowMinutes={windowMinutes} />

      <div className="stat-grid">
        <button
          className={`stat-card all ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          <div className="stat-count">{urls.length}</div>
          <div className="stat-label">Total</div>
        </button>
        {GROUP_ORDER.map((g) => (
          <button
            key={g}
            className={`stat-card g-${g} ${filter === g ? "active" : ""}`}
            onClick={() => setFilter(g)}
          >
            <div className="stat-count">{groups[g]}</div>
            <div className="stat-label">
              <span className="stat-code">{g.toUpperCase()}</span>
              <span className="stat-text">{GROUP_LABEL[g]}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="actions-row">
        <h2 className="section-title">
          Monitored URLs
          {filter !== "all" && <span className="muted small"> · {filter.toUpperCase()}</span>}
          {search && <span className="muted small"> · "{search}"</span>}
        </h2>
        <div className="action-buttons">
          <button className="ghost" onClick={props.onManageKeys}>
            🔑 Manage keys ({project.apiKeys.length})
          </button>
          <button className="primary" onClick={props.onAddUrl}>
            + Add URL
          </button>
        </div>
      </div>

      <div className="search-block">
        <div className="search-input-wrap">
          <span className="search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            ref={searchRef}
            className="search-input"
            type="search"
            placeholder="Search by URL, description, or method…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button
              className="search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              title="Clear (Esc)"
            >
              ✕
            </button>
          ) : (
            <kbd className="search-kbd" title="Press '/' to search">/</kbd>
          )}
          <span className={`search-result-count ${search || filter !== "all" || methodFilter !== "all" ? "active" : ""}`}>
            {filteredUrls.length} result{filteredUrls.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="method-chips">
          <button
            className={`method-chip ${methodFilter === "all" ? "active" : ""}`}
            onClick={() => setMethodFilter("all")}
          >
            All <span className="chip-count">{urls.length}</span>
          </button>
          {(["GET", "POST", "PUT", "PATCH"] as HttpMethod[]).map((m) => {
            const count = methodCounts[m];
            if (count === 0 && methodFilter !== m) return null;
            return (
              <button
                key={m}
                className={`method-chip method-${m.toLowerCase()} ${methodFilter === m ? "active" : ""}`}
                onClick={() => setMethodFilter(m)}
              >
                {m} <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visibleUrls.length === 0 ? (
        <EmptyUrls
          hasAny={urls.length > 0}
          filterActive={filter !== "all" || methodFilter !== "all" || !!search.trim()}
          onAdd={props.onAddUrl}
          onClearFilter={() => {
            setFilter("all");
            setMethodFilter("all");
            setSearch("");
          }}
        />
      ) : (
        <>
          <div className="url-list">
            {visibleUrls.map((u) => (
              <UrlCard
                key={u.id}
                url={u}
                project={project}
                sparkline={sparklineByUrl[u.id]}
                refreshTick={refreshTick}
                windowMinutes={windowMinutes}
                onCheck={() => props.onCheckUrl(u.id)}
                onRemove={() => props.onRemoveUrl(u.id)}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              current={safePage}
              total={totalPages}
              onChange={setPage}
              count={filteredUrls.length}
              pageSize={PAGE_SIZE}
            />
          )}
        </>
      )}
    </main>
  );
}

function EmptyUrls(props: {
  hasAny: boolean;
  filterActive: boolean;
  onAdd: () => void;
  onClearFilter: () => void;
}) {
  if (props.filterActive) {
    return (
      <div className="empty-card">
        <div className="empty-icon">🎯</div>
        <h3>No URLs match this filter</h3>
        <p>Try a different status group or clear the search.</p>
        <button className="primary" onClick={props.onClearFilter}>
          Show all URLs
        </button>
      </div>
    );
  }
  return (
    <div className="empty-card">
      <div className="empty-icon">📡</div>
      <h3>No URLs in this project yet</h3>
      <p>
        Add your first endpoint to start monitoring its uptime, status, latency phases, and
        assertions.
      </p>
      <button className="primary" onClick={props.onAdd}>
        + Add your first URL
      </button>
    </div>
  );
}

function Pagination(props: {
  current: number;
  total: number;
  count: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const { current, total, onChange, count, pageSize } = props;
  const pages = pageRange(current, total);
  const from = current * pageSize + 1;
  const to = Math.min((current + 1) * pageSize, count);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-info">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{count}</strong>
      </span>

      <div className="pagination-pages">
        <button
          className="page-btn page-arrow"
          onClick={() => onChange(Math.max(0, current - 1))}
          disabled={current === 0}
          aria-label="Previous page"
          title="Previous"
        >
          ‹
        </button>

        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e${i}`} className="page-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              className={`page-btn ${p === current ? "active" : ""}`}
              onClick={() => onChange(p)}
              aria-current={p === current ? "page" : undefined}
              aria-label={`Page ${p + 1}`}
            >
              {p + 1}
            </button>
          )
        )}

        <button
          className="page-btn page-arrow"
          onClick={() => onChange(Math.min(total - 1, current + 1))}
          disabled={current >= total - 1}
          aria-label="Next page"
          title="Next"
        >
          ›
        </button>
      </div>
    </nav>
  );
}

/**
 * Build the visible page-number list with smart ellipsis.
 * Always shows: first, last, current, and current ± 1.
 *
 * total=10, cur=0  → [1, 2, ..., 10]
 * total=10, cur=4  → [1, ..., 4, 5, 6, ..., 10]
 * total=10, cur=9  → [1, ..., 8, 9, 10]
 */
function pageRange(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i);
  }
  const set = new Set<number>([0, total - 1, current, current - 1, current + 1]);
  const sorted = [...set].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    out.push(sorted[i]);
    if (i < sorted.length - 1 && sorted[i + 1] - sorted[i] > 1) {
      out.push("ellipsis");
    }
  }
  return out;
}
