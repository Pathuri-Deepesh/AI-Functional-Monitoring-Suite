import { useEffect, useMemo, useRef, useState } from "react";
import { UrlCard } from "./UrlCard";
import { KpiBar } from "./KpiBar";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { FlowCard } from "./FlowCard";
import { PrereqsPanel } from "./PrereqsPanel";
import { Spinner } from "./Spinner";
import {
  checkAllUrls,
  fetchFlowRun,
  fetchPrereqRun,
  fetchPrereqs,
  fetchSparkline,
  listProjectFlows,
  runFlowAsync,
  runPrereqsAsync,
} from "../api";
import type {
  Flow,
  HttpMethod,
  MonitoredUrl,
  PrereqStep,
  Project,
  SparklinePoint,
  StatusGroup,
} from "../types";

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
  onCheckAllUrls: () => void | Promise<void>;
  checkAllUrlsBusy: boolean;
  /** Called after orchestrated check phases so the parent can refresh snapshot/flows. */
  onAfterFullCheck: () => void | Promise<void>;
  /** Lets the orchestrator surface a final summary toast. */
  onToast: (message: string, kind?: "success" | "error" | "info") => void;
  onCheckUrl: (id: string) => void | Promise<void>;
  onRemoveUrl: (id: string) => void | Promise<void>;
  onCreateFlow: () => void;
  onEditFlow: (flow: Flow) => void;
  onAddStep: (flow: Flow) => void;
  onEditStep: (flow: Flow, stepId: string) => void;
  onDeleteFlow: (flow: Flow) => void;
  onAddPrereqStep: (siblings: PrereqStep[]) => void;
  onEditPrereqStep: (step: PrereqStep, siblings: PrereqStep[]) => void;
  refreshTick: number;
}

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 5 * 60_000;

type SectionTab = "urls" | "flows";

function readTabFromHash(): SectionTab {
  if (typeof window === "undefined") return "urls";
  const h = window.location.hash.replace("#", "");
  return h === "flows" ? "flows" : "urls";
}

export function ProjectView(props: Props) {
  const { project, urls, refreshTick } = props;
  const [filter, setFilter] = useState<StatusGroup | "all">("all");
  const [methodFilter, setMethodFilter] = useState<HttpMethod | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [windowMinutes, setWindowMinutes] = useState(24 * 60); // default: 24h
  const [sparklineByUrl, setSparklineByUrl] = useState<Record<string, SparklinePoint[]>>({});
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowsTick, setFlowsTick] = useState(0); // bumped when a flow runs; triggers a re-fetch
  // When a FlowCard's "Run now" kicks off the prereq chain, this holds the
  // runId so the PrereqsPanel above can attach to it and show the full
  // step-by-step progress UI (not just FlowCard's inline banner).
  const [externalPrereqRunId, setExternalPrereqRunId] = useState<string | null>(null);
  // "Run full check" orchestration state — each phase visible in the matching
  // panel/card via existing live progress UI, plus a sticky banner up top.
  const [fullCheckBusy, setFullCheckBusy] = useState(false);
  const [fullCheckPhase, setFullCheckPhase] = useState<
    | { kind: "idle" }
    | { kind: "prereqs" }
    | { kind: "urls"; checked: number; total: number }
    | { kind: "flow"; flowName: string; index: number; total: number }
    | { kind: "done" }
  >({ kind: "idle" });
  /** flowId currently being executed by the orchestrator — FlowCard attaches via externalRunId. */
  const [orchestratorFlowRunId, setOrchestratorFlowRunId] = useState<{
    flowId: string;
    runId: string;
  } | null>(null);
  const fullCheckAbort = useRef<{ cancelled: boolean } | null>(null);
  const [tab, setTab] = useState<SectionTab>(readTabFromHash);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sync tab <-> URL hash
  useEffect(() => {
    const next = `#${tab}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [tab]);
  useEffect(() => {
    function onHashChange() {
      setTab(readTabFromHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Failing counts for tab badge color
  const failingUrls = useMemo(
    () =>
      urls.filter(
        (u) => u.statusGroup === "5xx" || u.statusGroup === "error" || u.statusGroup === "4xx"
      ).length,
    [urls]
  );

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

  // Load flows for this project — re-fetches when:
  //   - project changes
  //   - the global polling tick bumps (snapshot refresh)
  //   - a flow finishes a manual run (flowsTick — for instant KPI update)
  useEffect(() => {
    let cancelled = false;
    listProjectFlows(project.id)
      .then((fl) => {
        if (!cancelled) setFlows(fl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id, refreshTick, flowsTick]);

  // Cancel any in-flight full-check polling when unmounting / project changes.
  useEffect(() => {
    return () => {
      if (fullCheckAbort.current) fullCheckAbort.current.cancelled = true;
    };
  }, [project.id]);

  /**
   * "Run full check" orchestrator — visible, sequential. Each phase surfaces in
   * the matching panel/card's existing live progress UI, plus a sticky banner.
   *
   * Order:
   *   1. Prereqs (if enabled + has steps) — PrereqsPanel attaches via externalRunId.
   *   2. URLs in parallel + flows one-at-a-time. URLs auto-refresh via snapshot
   *      polling; each flow attaches via per-card externalRunId.
   */
  async function runFullCheckOrchestrator() {
    if (fullCheckBusy) return;
    setFullCheckBusy(true);
    const abort = { cancelled: false };
    fullCheckAbort.current = abort;
    const startedAt = Date.now();
    let prereqsOk: boolean | null = null;
    let urlsResult: { checked: number; ok: number; failed: number } | null = null;
    const flowResults: { name: string; ok: boolean }[] = [];

    try {
      // ===== PHASE 1: Prereqs (sequential, before everything else) =====
      try {
        const bundle = await fetchPrereqs(project.id);
        if (!abort.cancelled && bundle.enabled && bundle.steps.length > 0) {
          setFullCheckPhase({ kind: "prereqs" });
          const { runId } = await runPrereqsAsync(project.id, { force: true });
          setExternalPrereqRunId(runId);
          const deadline = Date.now() + POLL_TIMEOUT_MS;
          while (!abort.cancelled && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            if (abort.cancelled) return;
            try {
              const pr = await fetchPrereqRun(runId);
              if (pr.endedAt != null) {
                prereqsOk = pr.ok;
                break;
              }
            } catch {
              // transient — keep polling
            }
          }
        }
      } catch {
        // Prereq fetch failure shouldn't abort the rest of the check.
      }
      if (abort.cancelled) return;

      // ===== PHASE 2a: Kick off URL checks in parallel (don't block flows) =====
      const enabledFlows = flows.filter((f) => f.enabled);
      setFullCheckPhase({ kind: "urls", checked: 0, total: urls.length });
      const urlsTask = (async () => {
        try {
          const r = await checkAllUrls(project.id);
          urlsResult = { checked: r.checked, ok: r.ok, failed: r.failed };
        } catch {
          urlsResult = { checked: 0, ok: 0, failed: 0 };
        }
      })();

      // ===== PHASE 2b: Flows — one at a time, visibly. =====
      for (let i = 0; i < enabledFlows.length; i++) {
        if (abort.cancelled) break;
        const f = enabledFlows[i];
        setFullCheckPhase({
          kind: "flow",
          flowName: f.name,
          index: i + 1,
          total: enabledFlows.length,
        });
        try {
          const { runId } = await runFlowAsync(f.id, { force: true });
          setOrchestratorFlowRunId({ flowId: f.id, runId });
          const deadline = Date.now() + POLL_TIMEOUT_MS;
          let runOk = false;
          while (!abort.cancelled && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            if (abort.cancelled) break;
            try {
              const run = await fetchFlowRun(runId);
              if (run.endedAt != null) {
                runOk = run.ok;
                break;
              }
            } catch {
              // transient — keep polling
            }
          }
          flowResults.push({ name: f.name, ok: runOk });
        } catch {
          flowResults.push({ name: f.name, ok: false });
        } finally {
          setOrchestratorFlowRunId(null);
        }
      }

      // Wait for the parallel URL task to settle so the toast reflects truth.
      await urlsTask;
      if (abort.cancelled) return;

      // ===== Done — refresh + summarize =====
      setFullCheckPhase({ kind: "done" });
      await props.onAfterFullCheck();
      const durMs = Date.now() - startedAt;
      const u = urlsResult ?? { checked: 0, ok: 0, failed: 0 };
      const flowsOk = flowResults.filter((f) => f.ok).length;
      const prereqLabel =
        prereqsOk === null ? "skipped" : prereqsOk ? "ok" : "fail";
      const allOk =
        u.failed === 0 && flowsOk === flowResults.length && prereqsOk !== false;
      props.onToast(
        `Full check done — URLs: ${u.ok}/${u.checked} ok, Flows: ${flowsOk}/${flowResults.length} ok, Prereqs: ${prereqLabel} (${durMs}ms)`,
        allOk ? "success" : "error"
      );
    } catch (e) {
      props.onToast(
        e instanceof Error ? `Full check failed: ${e.message}` : "Full check failed",
        "error"
      );
    } finally {
      if (!abort.cancelled) {
        // Brief delay so the user sees the final banner before it disappears.
        window.setTimeout(() => {
          if (abort.cancelled) return;
          setFullCheckBusy(false);
          setFullCheckPhase({ kind: "idle" });
          setOrchestratorFlowRunId(null);
          setExternalPrereqRunId(null);
        }, 1200);
      }
    }
  }

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
            onClick={runFullCheckOrchestrator}
            disabled={fullCheckBusy}
            title="Run prereqs (if enabled), every standalone URL, and every enabled flow right now"
          >
            {fullCheckBusy ? (
              <><Spinner size={11} /><span style={{ marginLeft: 6 }}>Running full check…</span></>
            ) : (
              "⚡ Run full check"
            )}
          </button>
          <button
            onClick={props.onRunAudit}
            disabled={props.auditRunning || urls.length === 0}
            title={
              urls.length === 0
                ? "Add at least one URL first"
                : "Snapshot the current state of every URL and flow into an HTML report and post it to Slack. Uses last-known status — no re-checks."
            }
          >
            {props.auditRunning ? "Snapshotting…" : "📊 Snapshot & report"}
          </button>
          <button className="ghost" onClick={props.onSettings} title="Project settings">
            ⚙
          </button>
          <button className="ghost destructive" onClick={props.onDeleteProject} title="Delete project">
            🗑
          </button>
        </div>
      </div>

      {fullCheckBusy && <FullCheckBanner phase={fullCheckPhase} />}

      <TimeRangeSelector value={windowMinutes} onChange={setWindowMinutes} />

      <KpiBar urls={urls} flows={flows} sparklineByUrl={sparklineByUrl} windowMinutes={windowMinutes} />

      {/* ===== PREREQS PANEL (visible regardless of which tab is active) ===== */}
      <PrereqsPanel
        project={project}
        refreshTick={refreshTick}
        onAddStep={props.onAddPrereqStep}
        onEditStep={props.onEditPrereqStep}
        onAfterRun={() => setFlowsTick((t) => t + 1)}
        externalRunId={externalPrereqRunId}
      />

      {/* ===== TAB NAV ===== */}
      <nav className="tabnav" role="tablist" aria-label="Project sections">
        <button
          role="tab"
          aria-selected={tab === "urls"}
          className={`tab-trigger ${tab === "urls" ? "active" : ""}`}
          onClick={() => setTab("urls")}
        >
          <span className="tab-icon">🔗</span>
          <span className="tab-label">Standalone URLs</span>
          <span className={`tab-count ${failingUrls > 0 ? "danger" : ""}`}>{urls.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "flows"}
          className={`tab-trigger ${tab === "flows" ? "active" : ""}`}
          onClick={() => setTab("flows")}
        >
          <span className="tab-icon">📋</span>
          <span className="tab-label">Flows</span>
          <span className="tab-count">{flows.length}</span>
        </button>
      </nav>

      {/* ===== TAB CONTENT ===== */}
      {tab === "urls" && (
        <div className="tab-body" key="urls">
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

          <UrlsSectionPanel
            project={project}
            urls={urls}
            visibleUrls={visibleUrls}
            filteredUrls={filteredUrls}
            filter={filter}
            search={search}
            setSearch={setSearch}
            methodFilter={methodFilter}
            setMethodFilter={setMethodFilter}
            setFilter={setFilter}
            methodCounts={methodCounts}
            searchRef={searchRef}
            sparklineByUrl={sparklineByUrl}
            refreshTick={refreshTick}
            windowMinutes={windowMinutes}
            onAddUrl={props.onAddUrl}
            onManageKeys={props.onManageKeys}
            onCheckUrl={props.onCheckUrl}
            onRemoveUrl={props.onRemoveUrl}
            onCheckAllUrls={props.onCheckAllUrls}
            checkAllUrlsBusy={props.checkAllUrlsBusy}
            totalPages={totalPages}
            safePage={safePage}
            setPage={setPage}
          />
        </div>
      )}

      {tab === "flows" && (
        <div className="tab-body" key="flows">
          <FlowsSectionPanel
            flows={flows}
            // Combine both ticks so a flow-local event (run finish, step
            // move/copy between flows) reloads every FlowCard's `detail`, not
            // just the flow list. Without this the target flow of a Move/Copy
            // would only show the new step on the next global poll.
            refreshTick={refreshTick + flowsTick}
            onCreate={props.onCreateFlow}
            onEdit={props.onEditFlow}
            onAddStep={props.onAddStep}
            onEditStep={props.onEditStep}
            onDelete={props.onDeleteFlow}
            onAfterFlowRun={() => setFlowsTick((t) => t + 1)}
            onPrereqRunStarted={setExternalPrereqRunId}
            orchestratorFlowRunId={orchestratorFlowRunId}
          />
        </div>
      )}
    </main>
  );
}

// =============================================================
// URLs Section panel (extracted so the JSX above stays readable)
// =============================================================
function UrlsSectionPanel(props: {
  project: Project;
  urls: MonitoredUrl[];
  visibleUrls: MonitoredUrl[];
  filteredUrls: MonitoredUrl[];
  filter: StatusGroup | "all";
  search: string;
  setSearch: (s: string) => void;
  methodFilter: HttpMethod | "all";
  setMethodFilter: (m: HttpMethod | "all") => void;
  setFilter: (f: StatusGroup | "all") => void;
  methodCounts: Record<HttpMethod, number>;
  searchRef: React.RefObject<HTMLInputElement>;
  sparklineByUrl: Record<string, SparklinePoint[]>;
  refreshTick: number;
  windowMinutes: number;
  onAddUrl: () => void;
  onManageKeys: () => void;
  onCheckUrl: (id: string) => void | Promise<void>;
  onRemoveUrl: (id: string) => void | Promise<void>;
  onCheckAllUrls: () => void | Promise<void>;
  checkAllUrlsBusy: boolean;
  totalPages: number;
  safePage: number;
  setPage: (p: number) => void;
}) {
  const {
    project,
    urls,
    visibleUrls,
    filteredUrls,
    filter,
    search,
    setSearch,
    methodFilter,
    setMethodFilter,
    setFilter,
    methodCounts,
    searchRef,
    sparklineByUrl,
    refreshTick,
    windowMinutes,
    onAddUrl,
    onManageKeys,
    onCheckUrl,
    onRemoveUrl,
    totalPages,
    safePage,
    setPage,
  } = props;

  return (
    <section className="section-panel">
      <header className="section-panel-head">
        <h2 className="section-panel-title">
          <span className="section-panel-icon">🔗</span>
          Standalone URLs
          <span className="section-panel-count">{urls.length}</span>
          {filter !== "all" && <span className="muted small"> · {filter.toUpperCase()}</span>}
          {search && <span className="muted small"> · "{search}"</span>}
        </h2>
        <div className="section-panel-actions">
          <button className="ghost" onClick={onManageKeys}>
            🔑 Manage keys ({project.apiKeys.length})
          </button>
          <button className="primary" onClick={onAddUrl}>
            + Add URL
          </button>
        </div>
      </header>

      <div className="section-panel-body">
        {urls.length > 0 && (
          <div className="section-panel-filters">
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
              <span
                className={`search-result-count ${
                  search || filter !== "all" || methodFilter !== "all" ? "active" : ""
                }`}
              >
                {filteredUrls.length} result{filteredUrls.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="method-chips-row">
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
                      className={`method-chip method-${m.toLowerCase()} ${
                        methodFilter === m ? "active" : ""
                      }`}
                      onClick={() => setMethodFilter(m)}
                    >
                      {m} <span className="chip-count">{count}</span>
                    </button>
                  );
                })}
              </div>

              <button
                className="primary check-all-urls-btn"
                onClick={props.onCheckAllUrls}
                disabled={props.checkAllUrlsBusy || urls.length === 0}
                title="Run every standalone URL in this project right now (ignores flows + prereqs)"
              >
                {props.checkAllUrlsBusy ? "Checking…" : "⚡ Check all now"}
              </button>
            </div>
          </div>
        )}

        {visibleUrls.length === 0 ? (
          <EmptyUrls
            hasAny={urls.length > 0}
            filterActive={filter !== "all" || methodFilter !== "all" || !!search.trim()}
            onAdd={onAddUrl}
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
                  onCheck={() => onCheckUrl(u.id)}
                  onRemove={() => onRemoveUrl(u.id)}
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
      </div>
    </section>
  );
}

// =============================================================
// Flows Section panel
// =============================================================
function FlowsSectionPanel(props: {
  flows: Flow[];
  refreshTick: number;
  onCreate: () => void;
  onEdit: (flow: Flow) => void;
  onAddStep: (flow: Flow) => void;
  onEditStep: (flow: Flow, stepId: string) => void;
  onDelete: (flow: Flow) => void;
  onAfterFlowRun: () => void;
  onPrereqRunStarted: (runId: string | null) => void;
  /** When the "Run full check" orchestrator is executing a flow, this names
   *  which flow + runId — that FlowCard attaches via its externalRunId prop. */
  orchestratorFlowRunId: { flowId: string; runId: string } | null;
}) {
  const { flows, refreshTick, onCreate, onEdit, onAddStep, onEditStep, onDelete, onAfterFlowRun, onPrereqRunStarted, orchestratorFlowRunId } = props;

  // Flow-level aggregate stats
  const totalFlows = flows.length;
  const healthyFlows = flows.filter((f) => f.lastRunOk === true).length;
  const failingFlows = flows.filter((f) => f.lastRunOk === false).length;
  const pendingFlows = totalFlows - healthyFlows - failingFlows;
  const lastRunTimes = flows
    .map((f) => f.lastRunTotalMs)
    .filter((x): x is number => x != null && x > 0);
  const avgRunMs =
    lastRunTimes.length > 0
      ? Math.round(lastRunTimes.reduce((a, b) => a + b, 0) / lastRunTimes.length)
      : null;
  // Find the most-recently-run flow (so we can show *which* flow ran, not just when)
  const mostRecentFlow = flows.reduce<Flow | null>(
    (acc, f) =>
      f.lastRunAt && (!acc || (acc.lastRunAt ?? 0) < f.lastRunAt) ? f : acc,
    null
  );

  return (
    <section className="section-panel">
      <header className="section-panel-head">
        <h2 className="section-panel-title">
          <span className="section-panel-icon">📋</span>
          Flows
          <span className="section-panel-count">{flows.length}</span>
        </h2>
        <div className="section-panel-actions">
          <button className="primary" onClick={onCreate}>
            + New flow
          </button>
        </div>
      </header>
      <div className="section-panel-body">
        {flows.length === 0 ? (
          <div className="empty-card flush">
            <div className="empty-icon">🔗</div>
            <h3>No flows yet</h3>
            <p>
              A flow is a sequence of dependent APIs that share captured values. Common use:
              login → fetch data → logout, where every step uses the token from login.
            </p>
            <button className="primary" onClick={onCreate}>
              + Create your first flow
            </button>
          </div>
        ) : (
          <>
            {/* Mini-KPI strip — at-a-glance flow health */}
            <div className="flow-kpi-strip">
              <div className="fk-cell" title="Number of flows defined in this project">
                <span className="fk-num">{totalFlows}</span>
                <span className="fk-lbl">Total</span>
              </div>
              <div
                className="fk-cell good"
                title="Flows whose most recent run completed successfully (all steps OK)"
              >
                <span className="fk-num">{healthyFlows}</span>
                <span className="fk-lbl">✓ Healthy</span>
              </div>
              <div
                className="fk-cell bad"
                title="Flows whose most recent run failed (any step failed)"
              >
                <span className="fk-num">{failingFlows}</span>
                <span className="fk-lbl">✗ Failing</span>
              </div>
              {pendingFlows > 0 && (
                <div
                  className="fk-cell muted"
                  title="Flows that have never been executed yet"
                >
                  <span className="fk-num">{pendingFlows}</span>
                  <span className="fk-lbl">Never run</span>
                </div>
              )}
              {avgRunMs != null && (
                <div
                  className="fk-cell"
                  title="Average duration of the most recent run, across all flows"
                >
                  <span className="fk-num">
                    {avgRunMs}
                    <span className="fk-unit">ms</span>
                  </span>
                  <span className="fk-lbl">Avg run</span>
                </div>
              )}
              {mostRecentFlow && mostRecentFlow.lastRunAt && (
                <div
                  className="fk-cell time"
                  title={`Most recent activity: "${mostRecentFlow.name}" ran at ${new Date(
                    mostRecentFlow.lastRunAt
                  ).toLocaleString()}`}
                >
                  <span className="fk-num">{formatRelative(mostRecentFlow.lastRunAt)}</span>
                  <span className="fk-lbl">Last flow run</span>
                  <span className="fk-sub" title={mostRecentFlow.name}>
                    {mostRecentFlow.name}
                  </span>
                </div>
              )}
            </div>

            <div className="flow-list">
              {flows.map((f) => (
                <FlowCard
                  key={f.id}
                  flow={f}
                  onEdit={() => onEdit(f)}
                  onAddStep={() => onAddStep(f)}
                  onEditStep={(stepId) => onEditStep(f, stepId)}
                  onDelete={() => onDelete(f)}
                  onAfterRun={onAfterFlowRun}
                  onPrereqRunStarted={onPrereqRunStarted}
                  externalRunId={
                    orchestratorFlowRunId?.flowId === f.id
                      ? orchestratorFlowRunId.runId
                      : null
                  }
                  refreshTick={refreshTick}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function formatRelative(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// =============================================================
// "Run full check" sticky progress banner
// =============================================================
function FullCheckBanner(props: {
  phase:
    | { kind: "idle" }
    | { kind: "prereqs" }
    | { kind: "urls"; checked: number; total: number }
    | { kind: "flow"; flowName: string; index: number; total: number }
    | { kind: "done" };
}) {
  const { phase } = props;
  let icon = "⚡";
  let label = "Full check running…";
  let detail = "";
  if (phase.kind === "prereqs") {
    icon = "🔑";
    label = "Refreshing prerequisites";
    detail = "Capturing fresh tokens before flows run…";
  } else if (phase.kind === "urls") {
    icon = "🔗";
    label = "Checking standalone URLs + running flows";
    detail = "URL pings dispatch in parallel while flows execute one at a time.";
  } else if (phase.kind === "flow") {
    icon = "📋";
    label = `Running flow ${phase.index} of ${phase.total}`;
    detail = `“${phase.flowName}” — open the Flows tab to watch step-by-step.`;
  } else if (phase.kind === "done") {
    icon = "✓";
    label = "Full check complete";
    detail = "Refreshing data…";
  }
  return (
    <div className="full-check-banner" role="status" aria-live="polite">
      <div className="full-check-banner-icon" aria-hidden>{icon}</div>
      <div className="full-check-banner-body">
        <div className="full-check-banner-label">
          {phase.kind !== "done" && <Spinner size={12} />}
          <strong>{label}</strong>
        </div>
        {detail && <div className="full-check-banner-detail muted small">{detail}</div>}
      </div>
    </div>
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
