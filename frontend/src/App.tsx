import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  checkAllUrls,
  checkUrlNow,
  deleteFlow,
  deleteProject,
  fetchFlow,
  fetchProjectVariables,
  fetchStatus,
  removeUrl,
  runAudit,
} from "./api";
import { Sidebar } from "./components/Sidebar";
import { ProjectView } from "./components/ProjectView";
import { ConfirmDialog, Modal, ToastStack, type ToastItem } from "./components/Modal";
import { SkeletonProject, SkeletonSidebar } from "./components/Skeleton";
import { Spinner } from "./components/Spinner";
import {
  AddUrlForm,
  CreateProjectForm,
  SettingsPage,
  type SettingsPanel,
} from "./components/forms";
import { FlowEditorForm, PrereqStepEditorForm, StepEditorForm } from "./components/flowForms";
import { ImportSwaggerModal } from "./components/ImportSwaggerModal";
import { applyTheme, getThemePref } from "./theme";
import type {
  AuditResult,
  Flow,
  FlowStep,
  FlowWithSteps,
  FullSnapshot,
  MonitoredUrl,
  PrereqStep,
  Project,
  ProjectVariable,
} from "./types";

const POLL_MS = 3000;
const ACTIVE_PROJECT_KEY = "fm:active-project-id";
const SCROLL_KEY_PREFIX = "fm:scroll:";
const SECTION_KEY_PREFIX = "fm:section:";
type SectionTab = "urls" | "flows";

function readSavedProjectId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function saveProjectId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
  } catch {
    /* ignore (e.g. private mode quota) */
  }
}

function readSavedScroll(projectId: string): number {
  try {
    const v = window.localStorage.getItem(SCROLL_KEY_PREFIX + projectId);
    if (!v) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function saveScroll(projectId: string, y: number): void {
  try {
    if (y > 0) {
      window.localStorage.setItem(SCROLL_KEY_PREFIX + projectId, String(Math.floor(y)));
    } else {
      window.localStorage.removeItem(SCROLL_KEY_PREFIX + projectId);
    }
  } catch {
    /* ignore */
  }
}

function readSavedSection(projectId: string): SectionTab | null {
  try {
    const v = window.localStorage.getItem(SECTION_KEY_PREFIX + projectId);
    return v === "urls" || v === "flows" ? v : null;
  } catch {
    return null;
  }
}

function saveSection(projectId: string, hash: string): void {
  try {
    const clean = hash.replace(/^#/, "");
    if (clean === "urls" || clean === "flows") {
      window.localStorage.setItem(SECTION_KEY_PREFIX + projectId, clean);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Phase 1.27.9 — prune stale localStorage keys.
 * Every project visit writes `fm:scroll:<projectId>` and `fm:section:<projectId>`
 * entries. When a project is deleted they leak forever, eventually hitting
 * the ~5MB quota OR leaking the list of project IDs the user ever touched
 * to any future script with DOM access. This sweeps any key whose
 * projectId doesn't appear in the current snapshot.
 */
function pruneStaleLocalStorage(currentProjectIds: Set<string>): void {
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(SCROLL_KEY_PREFIX)) {
        const pid = key.slice(SCROLL_KEY_PREFIX.length);
        if (!currentProjectIds.has(pid)) toDelete.push(key);
      } else if (key.startsWith(SECTION_KEY_PREFIX)) {
        const pid = key.slice(SECTION_KEY_PREFIX.length);
        if (!currentProjectIds.has(pid)) toDelete.push(key);
      }
    }
    for (const k of toDelete) window.localStorage.removeItem(k);
  } catch {
    /* ignore (private mode, full quota, etc.) */
  }
}

type ModalState =
  | { kind: "none" }
  | { kind: "create-project" }
  | { kind: "add-url"; project: Project }
  | { kind: "edit-url"; project: Project; url: MonitoredUrl }
  | { kind: "confirm-delete-project"; project: Project }
  | { kind: "confirm-delete-url"; urlId: string; urlText: string }
  | { kind: "audit-running"; projectName: string }
  | { kind: "audit-result"; result: AuditResult; projectName: string }
  | { kind: "create-flow"; project: Project }
  | { kind: "edit-flow"; project: Project; flow: Flow }
  | { kind: "add-step"; project: Project; flowDetail: FlowWithSteps; projectVars: ProjectVariable[] }
  | { kind: "edit-step"; project: Project; flowDetail: FlowWithSteps; step: FlowStep; projectVars: ProjectVariable[] }
  | { kind: "confirm-delete-flow"; flow: Flow }
  | { kind: "add-prereq-step"; project: Project; siblings: PrereqStep[] }
  | { kind: "edit-prereq-step"; project: Project; siblings: PrereqStep[]; step: PrereqStep }
  | { kind: "import-swagger"; project: Project };

export default function App() {
  const [snapshot, setSnapshot] = useState<FullSnapshot | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => readSavedProjectId());
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  // True while the confirm-delete-project flow is awaiting the backend cascade
  // delete + snapshot refresh. Drives ConfirmDialog's busy state so the user
  // sees "⏳ Deleting…" instead of a frozen modal during big-project deletes.
  const [deletingProject, setDeletingProject] = useState(false);
  const [busyCheckUrls, setBusyCheckUrls] = useState<string | null>(null);
  const toastSeq = useRef(0);
  const timer = useRef<number | null>(null);
  // Polls fire every 3s — surface connection loss once on the down-edge and
  // again on recovery, not every failed tick (would spam the toast stack).
  const connectionLost = useRef(false);
  /**
   * In-memory per-project scroll position cache.
   * Switching projects: save outgoing scrollY → restore incoming (or 0 on first visit).
   * Mirrored to localStorage on selectProject + page-hide so a reload returns
   * the user to where they left off.
   */
  const scrollPositions = useRef<Map<string, number>>(new Map());
  /** Whether we've already done the first project-mount (skip in-session restore on it). */
  const skipNextScrollRestore = useRef(true);
  /** One-shot guard for the post-reload restore from localStorage (only the first snapshot triggers it). */
  const initialRestoreDone = useRef(false);

  /**
   * Switch projects, remembering both scroll AND section per project.
   * - Outgoing project: snapshot its current scroll + section to localStorage.
   * - Incoming project: restore its last section (default "urls" for first-visit
   *   projects), and let the scroll-restore effect handle the Y position.
   * Direct page refresh still respects the #urls / #flows hash for deep linking
   * (we don't override the URL on first render — only on explicit project clicks).
   */
  function selectProject(id: string) {
    if (id === activeProjectId) return;
    if (activeProjectId) {
      const y = window.scrollY;
      scrollPositions.current.set(activeProjectId, y);
      saveScroll(activeProjectId, y);
      saveSection(activeProjectId, window.location.hash || "#urls");
    }
    const targetSection: SectionTab = readSavedSection(id) ?? "urls";
    const targetHash = `#${targetSection}`;
    if (window.location.hash !== targetHash) {
      window.history.replaceState(null, "", targetHash);
      // Dispatch hashchange so ProjectView's listener picks it up if it doesn't remount in time.
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    setActiveProjectId(id);
  }

  // After a project switch, restore the saved scroll position (or scroll to top on first visit).
  // Uses useLayoutEffect + rAF so it runs after the new ProjectView has committed.
  useLayoutEffect(() => {
    if (!activeProjectId) return;
    if (skipNextScrollRestore.current) {
      skipNextScrollRestore.current = false;
      return;
    }
    const saved = scrollPositions.current.get(activeProjectId) ?? 0;
    requestAnimationFrame(() => {
      window.scrollTo({ top: saved, behavior: "auto" });
    });
  }, [activeProjectId]);

  // One-shot: after the *first* snapshot for the *initial* project hydrates, restore
  // the scroll position the user left off at before the last page reload.
  // Gated on `snapshot` so the ProjectView has actually mounted with real content
  // (otherwise scrollTo before layout would silently clamp to 0).
  useLayoutEffect(() => {
    if (initialRestoreDone.current) return;
    if (!activeProjectId || !snapshot) return;
    initialRestoreDone.current = true;
    const saved = readSavedScroll(activeProjectId);
    if (saved <= 0) return;
    // Seed the in-memory cache too so a project-switch round-trip preserves the same spot.
    scrollPositions.current.set(activeProjectId, saved);
    // Double-rAF: first frame lets the ProjectView paint, second gives lazy children a tick to expand.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: saved, behavior: "auto" });
      });
    });
  }, [activeProjectId, snapshot]);

  // Persist current scroll position whenever the page is about to be hidden
  // (reload, tab close, tab switch). beforeunload alone is unreliable on mobile,
  // so we also listen to pagehide + visibilitychange.
  useEffect(() => {
    function save() {
      if (!activeProjectId) return;
      saveScroll(activeProjectId, window.scrollY);
      saveSection(activeProjectId, window.location.hash || "#urls");
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") save();
    }
    window.addEventListener("beforeunload", save);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeProjectId]);

  function pushToast(message: string, kind: ToastItem["kind"] = "success") {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }

  function dismissToast(id: number) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  async function refresh() {
    try {
      const data = await fetchStatus();
      setSnapshot(data);
      // Phase 1.27.9 — sweep stale localStorage keys (scroll / section state
      // for projects that no longer exist).
      pruneStaleLocalStorage(new Set(data.projects.map((p) => p.id)));
      setActiveProjectId((current) => {
        // Prefer current state, then the saved id (in case state hasn't hydrated yet),
        // then fall back to the first available project.
        if (current && data.projects.some((p) => p.id === current)) return current;
        const saved = readSavedProjectId();
        if (saved && data.projects.some((p) => p.id === saved)) return saved;
        return data.projects[0]?.id ?? null;
      });
      if (connectionLost.current) {
        connectionLost.current = false;
        pushToast("Reconnected to the server.", "success");
      }
    } catch (e) {
      console.error(e);
      if (!connectionLost.current) {
        connectionLost.current = true;
        pushToast("Lost connection to the backend — showing stale data until it returns.", "error");
      }
    }
  }

  // Persist the active project so a page refresh lands on the same one
  useEffect(() => {
    saveProjectId(activeProjectId);
  }, [activeProjectId]);

  // Reflect the active project (and any failing count) in the document title.
  // Helps when the dashboard is one tab among many — failures jump out.
  useEffect(() => {
    const project = snapshot?.projects.find((p) => p.id === activeProjectId);
    const projectUrls = snapshot?.urls.filter((u) => u.projectId === activeProjectId) ?? [];
    const failing = projectUrls.filter(
      (u) => u.statusGroup === "4xx" || u.statusGroup === "5xx" || u.statusGroup === "error"
    ).length;
    const base = "Functional Monitor";
    if (!project) {
      document.title = base;
      return;
    }
    document.title = failing > 0
      ? `(${failing} failing) ${project.name} · ${base}`
      : `${project.name} · ${base}`;
  }, [snapshot, activeProjectId]);

  useEffect(() => {
    refresh();
    timer.current = window.setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply persisted theme on mount (before first significant paint).
  // Subscribe to system-theme flips so "system" preference flips live.
  useEffect(() => {
    const pref = getThemePref();
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // ----- Settings page routing (hash-based: #settings or #settings/<panel>) ---
  // Driven entirely by the URL so the browser Back button just works: pushState
  // when opening, the user's Back pop fires hashchange → settingsView clears.
  const [settingsView, setSettingsView] = useState<{
    active: boolean;
    panel: SettingsPanel;
  }>(() => {
    const m = window.location.hash.match(/^#settings(?:\/(.+))?$/);
    return m
      ? { active: true, panel: (m[1] as SettingsPanel) || "general" }
      : { active: false, panel: "general" };
  });

  useEffect(() => {
    function onHash() {
      const m = window.location.hash.match(/^#settings(?:\/(.+))?$/);
      if (m) {
        setSettingsView({
          active: true,
          panel: (m[1] as SettingsPanel) || "general",
        });
      } else {
        setSettingsView((prev) => (prev.active ? { ...prev, active: false } : prev));
      }
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function openSettings(panel: SettingsPanel = "general") {
    const target = `#settings/${panel}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
    setSettingsView({ active: true, panel });
  }

  function closeSettings() {
    // Browser back pops the #settings entry pushed by openSettings, which
    // fires hashchange and clears settingsView. If there's no history entry
    // (e.g. user deep-linked here directly), fall back to an explicit nav.
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", "#urls");
      setSettingsView((prev) => ({ ...prev, active: false }));
    }
  }

  function changeSettingsPanel(panel: SettingsPanel) {
    const target = `#settings/${panel}`;
    if (window.location.hash !== target) {
      // replaceState (not push) so Back still returns to the project view
      // instead of bouncing between settings panels.
      window.history.replaceState(null, "", target);
    }
    setSettingsView({ active: true, panel });
  }

  // Settings-page action callback: refresh + toast, DON'T navigate. Distinct
  // from handleFormDone (below) which is used by add-url / edit-url / etc.
  // modals that should close after a successful save.
  async function handleSettingsAction(message?: string) {
    if (message) pushToast(message);
    await refresh();
    setRefreshTick((t) => t + 1);
  }

  const activeProject = useMemo(
    () => snapshot?.projects.find((p) => p.id === activeProjectId) ?? null,
    [snapshot, activeProjectId]
  );
  const projectUrls = useMemo(
    () => snapshot?.urls.filter((u) => u.projectId === activeProjectId) ?? [],
    [snapshot, activeProjectId]
  );

  async function handleCheckUrl(id: string) {
    try {
      await checkUrlNow(id);
      await refresh();
      setRefreshTick((t) => t + 1);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Check failed", "error");
    }
  }

  async function handleDeleteUrl(id: string) {
    const u = snapshot?.urls.find((x) => x.id === id);
    setModal({ kind: "confirm-delete-url", urlId: id, urlText: u?.url ?? "this URL" });
  }

  async function confirmDeleteUrl() {
    if (modal.kind !== "confirm-delete-url") return;
    try {
      await removeUrl(modal.urlId);
      pushToast("URL removed");
      await refresh();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Failed to remove", "error");
    } finally {
      setModal({ kind: "none" });
    }
  }

  async function confirmDeleteProject() {
    if (modal.kind !== "confirm-delete-project") return;
    setDeletingProject(true);
    try {
      await deleteProject(modal.project.id);
      pushToast(`Deleted "${modal.project.name}"`);
      await refresh();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Failed to delete", "error");
    } finally {
      setDeletingProject(false);
      setModal({ kind: "none" });
    }
  }

  async function openAddStep(flow: Flow) {
    if (!activeProject) return;
    const [detail, projectVars] = await Promise.all([
      fetchFlow(flow.id),
      fetchProjectVariables(activeProject.id).catch(() => []),
    ]);
    setModal({ kind: "add-step", project: activeProject, flowDetail: detail, projectVars });
  }

  async function openEditStep(flow: Flow, stepId: string) {
    if (!activeProject) return;
    const [detail, projectVars] = await Promise.all([
      fetchFlow(flow.id),
      fetchProjectVariables(activeProject.id).catch(() => []),
    ]);
    const step = detail.steps.find((s) => s.id === stepId);
    if (!step) return;
    setModal({ kind: "edit-step", project: activeProject, flowDetail: detail, step, projectVars });
  }

  async function confirmDeleteFlow() {
    if (modal.kind !== "confirm-delete-flow") return;
    try {
      await deleteFlow(modal.flow.id);
      pushToast(`Flow "${modal.flow.name}" deleted`);
      await refresh();
      setRefreshTick((t) => t + 1);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Failed to delete flow", "error");
    } finally {
      setModal({ kind: "none" });
    }
  }

  async function handleRunAudit() {
    if (!activeProject) return;
    setModal({ kind: "audit-running", projectName: activeProject.name });
    try {
      const result = await runAudit(activeProject.id);
      await refresh();
      setRefreshTick((t) => t + 1);
      setModal({ kind: "audit-result", result, projectName: activeProject.name });
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Audit failed", "error");
      setModal({ kind: "none" });
    }
  }

  async function handleCheckAllUrls() {
    if (!activeProject || busyCheckUrls) return;
    setBusyCheckUrls(activeProject.id);
    try {
      const r = await checkAllUrls(activeProject.id);
      await refresh();
      setRefreshTick((t) => t + 1);
      pushToast(
        `Checked ${r.checked} URL${r.checked === 1 ? "" : "s"} — ${r.ok} ok, ${r.failed} failed (${r.durationMs}ms)`,
        r.failed === 0 ? "success" : "error"
      );
    } catch (e) {
      pushToast(e instanceof Error ? `Check failed: ${e.message}` : "Check failed", "error");
    } finally {
      setBusyCheckUrls(null);
    }
  }

  async function handleAfterFullCheck() {
    await refresh();
    setRefreshTick((t) => t + 1);
  }

  async function handleFormDone(message?: string) {
    setModal({ kind: "none" });
    if (message) pushToast(message);
    await refresh();
    setRefreshTick((t) => t + 1);
  }

  // First-load skeleton (before the first snapshot arrives)
  if (snapshot === null) {
    return (
      <div className="app">
        <SkeletonSidebar />
        <SkeletonProject />
      </div>
    );
  }

  return (
    <div className={`app ${settingsView.active ? "app-settings" : ""}`}>
      {!settingsView.active && (
        <Sidebar
          projects={snapshot?.projects ?? []}
          urls={snapshot?.urls ?? []}
          activeProjectId={activeProjectId}
          onSelect={selectProject}
          onCreate={() => setModal({ kind: "create-project" })}
        />
      )}

      {activeProject && settingsView.active ? (
        <SettingsPage
          key={`settings-${activeProject.id}`}
          project={activeProject}
          initialPanel={settingsView.panel}
          onBack={closeSettings}
          onPanelChange={changeSettingsPanel}
          onDone={handleSettingsAction}
          onError={(m) => pushToast(m, "error")}
        />
      ) : activeProject ? (
        <ProjectView
          key={activeProject.id}
          project={activeProject}
          urls={projectUrls}
          refreshTick={refreshTick}
          onAddUrl={() => setModal({ kind: "add-url", project: activeProject })}
          onSettings={() => openSettings("general")}
          onDeleteProject={() =>
            setModal({ kind: "confirm-delete-project", project: activeProject })
          }
          onRunAudit={handleRunAudit}
          auditRunning={modal.kind === "audit-running"}
          onCheckAllUrls={handleCheckAllUrls}
          checkAllUrlsBusy={busyCheckUrls === activeProject.id}
          onAfterFullCheck={handleAfterFullCheck}
          onToast={pushToast}
          onCheckUrl={handleCheckUrl}
          onEditUrl={(url) => setModal({ kind: "edit-url", project: activeProject, url })}
          onRemoveUrl={handleDeleteUrl}
          onCreateFlow={() => setModal({ kind: "create-flow", project: activeProject })}
          onEditFlow={(flow) => setModal({ kind: "edit-flow", project: activeProject, flow })}
          onAddStep={openAddStep}
          onEditStep={openEditStep}
          onDeleteFlow={(flow) => setModal({ kind: "confirm-delete-flow", flow })}
          onAddPrereqStep={(siblings) =>
            setModal({ kind: "add-prereq-step", project: activeProject, siblings })
          }
          onEditPrereqStep={(step, siblings) =>
            setModal({ kind: "edit-prereq-step", project: activeProject, siblings, step })
          }
          onImportSwagger={() => setModal({ kind: "import-swagger", project: activeProject })}
        />
      ) : (
        <main className="main">
          <div className="empty-card big">
            <div className="empty-icon">🚀</div>
            <h3>Welcome to Functional Monitor</h3>
            <p>
              Group URLs by project, attach API keys, define assertions, and watch them live with
              full latency breakdowns and 24h history.
            </p>
            <button className="primary" onClick={() => setModal({ kind: "create-project" })}>
              + Create your first project
            </button>
          </div>
        </main>
      )}

      <Modal
        open={modal.kind === "create-project"}
        title="New project"
        subtitle="A project groups related URLs (e.g. one service) and their API keys."
        onClose={() => setModal({ kind: "none" })}
      >
        <CreateProjectForm onDone={handleFormDone} onError={(m) => pushToast(m, "error")} />
      </Modal>

      <Modal
        open={modal.kind === "add-url"}
        title="Add URL to monitor"
        subtitle={modal.kind === "add-url" ? `In project: ${modal.project.name}` : undefined}
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "add-url" && (
          <AddUrlForm
            project={modal.project}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <Modal
        open={modal.kind === "edit-url"}
        title="Edit URL"
        subtitle={modal.kind === "edit-url" ? modal.url.url : undefined}
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "edit-url" && (
          <AddUrlForm
            project={modal.project}
            url={modal.url}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>


      <Modal
        open={modal.kind === "import-swagger"}
        title="📥 Import from Swagger / OpenAPI"
        subtitle={
          modal.kind === "import-swagger"
            ? `Into project: ${modal.project.name}`
            : undefined
        }
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "import-swagger" && (
          <ImportSwaggerModal
            project={modal.project}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={modal.kind === "confirm-delete-project"}
        title="Delete project?"
        message={
          modal.kind === "confirm-delete-project"
            ? `This will permanently delete "${modal.project.name}", all of its URLs, and all check history. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete project"
        destructive
        busy={deletingProject}
        busyLabel="Deleting project + URL history…"
        onConfirm={confirmDeleteProject}
        onCancel={() => setModal({ kind: "none" })}
      />

      <Modal
        open={modal.kind === "create-flow" || modal.kind === "edit-flow"}
        title={modal.kind === "edit-flow" ? "Edit flow" : "New flow"}
        subtitle={
          modal.kind === "create-flow"
            ? `A flow is a sequence of dependent APIs that share captured variables.`
            : modal.kind === "edit-flow"
            ? `In project: ${modal.project.name}`
            : undefined
        }
        onClose={() => setModal({ kind: "none" })}
      >
        {modal.kind === "create-flow" && (
          <FlowEditorForm project={modal.project} onDone={handleFormDone} onError={(m) => pushToast(m, "error")} />
        )}
        {modal.kind === "edit-flow" && (
          <FlowEditorForm
            project={modal.project}
            flow={modal.flow}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <Modal
        open={modal.kind === "add-step" || modal.kind === "edit-step"}
        title={modal.kind === "edit-step" ? `Edit step ${modal.step.position}` : "Add step to flow"}
        subtitle={
          modal.kind === "add-step" || modal.kind === "edit-step"
            ? `Flow: ${modal.flowDetail.name}`
            : undefined
        }
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "add-step" && (
          <StepEditorForm
            flow={modal.flowDetail}
            project={modal.project}
            projectVars={modal.projectVars}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
        {modal.kind === "edit-step" && (
          <StepEditorForm
            flow={modal.flowDetail}
            project={modal.project}
            step={modal.step}
            projectVars={modal.projectVars}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <Modal
        open={modal.kind === "add-prereq-step" || modal.kind === "edit-prereq-step"}
        title={
          modal.kind === "edit-prereq-step"
            ? `Edit prereq step ${modal.step.position}`
            : "Add prerequisite step"
        }
        subtitle={
          modal.kind === "add-prereq-step" || modal.kind === "edit-prereq-step"
            ? `Project: ${modal.project.name} — captured vars become available everywhere in this project.`
            : undefined
        }
        onClose={() => setModal({ kind: "none" })}
        size="lg"
      >
        {modal.kind === "add-prereq-step" && (
          <PrereqStepEditorForm
            project={modal.project}
            siblingSteps={modal.siblings}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
        {modal.kind === "edit-prereq-step" && (
          <PrereqStepEditorForm
            project={modal.project}
            siblingSteps={modal.siblings}
            step={modal.step}
            onDone={handleFormDone}
            onError={(m) => pushToast(m, "error")}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={modal.kind === "confirm-delete-flow"}
        title="Delete flow?"
        message={
          modal.kind === "confirm-delete-flow"
            ? `Delete "${modal.flow.name}"? All its steps and run history will be lost.`
            : ""
        }
        confirmLabel="Delete flow"
        destructive
        onConfirm={confirmDeleteFlow}
        onCancel={() => setModal({ kind: "none" })}
      />

      <ConfirmDialog
        open={modal.kind === "confirm-delete-url"}
        title="Remove URL?"
        message={
          modal.kind === "confirm-delete-url"
            ? `Stop monitoring ${modal.urlText}? Its check history will also be deleted.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={confirmDeleteUrl}
        onCancel={() => setModal({ kind: "none" })}
      />

      <Modal
        open={modal.kind === "audit-running"}
        title="Generating report…"
        onClose={() => {
          /* intentionally not closable */
        }}
      >
        <div className="audit-progress">
          <Spinner size={36} inline={false} />
          <p>
            Snapshotting current state of <strong>{modal.kind === "audit-running" ? modal.projectName : ""}</strong>…
          </p>
          <p className="muted small">Uses the latest known status of every URL and flow — no fresh checks.</p>
        </div>
      </Modal>

      <Modal
        open={modal.kind === "audit-result"}
        title="Audit complete"
        subtitle={modal.kind === "audit-result" ? `Project: ${modal.projectName}` : undefined}
        onClose={() => setModal({ kind: "none" })}
      >
        {modal.kind === "audit-result" && (() => {
          const r = modal.result;
          const totalChecked = r.totalUrls + r.totalFlows;
          const totalOk = r.okUrls + r.okFlows;
          const totalFailing = r.failingUrls + r.failingFlows;
          const hasFlows = r.totalFlows > 0;
          return (
          <div className="audit-result">
            {/* Top summary — combined */}
            <div className="audit-summary">
              <div className="audit-stat">
                <div className="audit-num">{totalChecked}</div>
                <div className="audit-lbl">Endpoints checked</div>
                {hasFlows && (
                  <div className="audit-breakdown">
                    {r.totalUrls} URLs · {r.totalFlows} flows
                  </div>
                )}
              </div>
              <div className="audit-stat">
                <div className="audit-num" style={{ color: "var(--g-2xx)" }}>
                  {totalOk}
                </div>
                <div className="audit-lbl">Healthy</div>
                {hasFlows && (
                  <div className="audit-breakdown">
                    {r.okUrls} URLs · {r.okFlows} flows
                  </div>
                )}
              </div>
              <div className="audit-stat">
                <div
                  className="audit-num"
                  style={{ color: totalFailing > 0 ? "var(--g-5xx)" : "var(--g-2xx)" }}
                >
                  {totalFailing}
                </div>
                <div className="audit-lbl">Failing</div>
                {hasFlows && (
                  <div className="audit-breakdown">
                    {r.failingUrls} URLs · {r.failingFlows} flows
                  </div>
                )}
              </div>
            </div>

            {/* Split track — explicit URL vs Flow rows */}
            {hasFlows && (
              <div className="audit-tracks">
                <div className="audit-track">
                  <span className="audit-track-icon">🔗</span>
                  <span className="audit-track-label">Standalone URLs</span>
                  <span className="audit-track-ok">{r.okUrls} OK</span>
                  <span className={`audit-track-fail ${r.failingUrls > 0 ? "danger" : ""}`}>
                    {r.failingUrls} failing
                  </span>
                  <span className="audit-track-of">of {r.totalUrls}</span>
                </div>
                <div className="audit-track">
                  <span className="audit-track-icon">📋</span>
                  <span className="audit-track-label">Flows</span>
                  <span className="audit-track-ok">{r.okFlows} OK</span>
                  <span className={`audit-track-fail ${r.failingFlows > 0 ? "danger" : ""}`}>
                    {r.failingFlows} failing
                  </span>
                  <span className="audit-track-of">of {r.totalFlows}</span>
                </div>
              </div>
            )}

            <div className="audit-actions">
              <a
                className="audit-link"
                href={r.reportUrl}
                target="_blank"
                rel="noreferrer"
              >
                📄 Open HTML report
              </a>
              {r.slack.posted ? (
                <div className="audit-slack good">✅ Posted to Slack</div>
              ) : (
                <div className="audit-slack neutral">
                  ℹ️ Slack: {r.slack.reason ?? "not configured"}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="primary" onClick={() => setModal({ kind: "none" })}>
                Close
              </button>
            </div>
          </div>
          );
        })()}
      </Modal>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <footer className="app-footer">
        <span>
          Refreshed at {snapshot ? new Date(snapshot.lastUpdated).toLocaleTimeString() : "—"}
        </span>
        <span className="footer-help">
          Dashboard pulls fresh data every {POLL_MS / 1000}s · each URL is re-pinged on its own
          schedule (default 5 min) · click <strong>Check now</strong> to ping immediately
        </span>
      </footer>
    </div>
  );
}
