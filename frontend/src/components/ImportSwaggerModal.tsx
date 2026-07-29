import { useState } from "react";
import { applySwaggerImport, previewSwaggerImport } from "../api";
import type {
  ImportApiKeyCreate,
  ImportAuthSchemePreview,
  ImportEndpointPreview,
  ImportFlowPreview,
  ImportPreview,
  ImportPrereqPreview,
  Project,
} from "../types";

interface Props {
  project: Project;
  onDone: (msg?: string) => void | Promise<void>;
  onError?: (msg: string) => void;
}

/**
 * Phase 1.26 — Import Monitored URLs (and optionally round-tripped flows/prereqs)
 * from a Swagger / OpenAPI 3.x spec URL.
 *
 * Three-step wizard:
 *   1. Spec URL + options ("Show deprecated", Base URL override)
 *   2. Preview — checkbox selection per section, auth-vault matching
 *   3. Apply + result summary
 */
export function ImportSwaggerModal(props: Props) {
  const [specUrl, setSpecUrl] = useState("");
  // Local-file import: when the user browses to a spec on their machine, the
  // browser reads its TEXT (not its path — browsers can't expose paths) and we
  // send that as specContent. Takes precedence over specUrl when set.
  const [specContent, setSpecContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [baseUrlOverride, setBaseUrlOverride] = useState("");
  const [includeDeprecated, setIncludeDeprecated] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const [selEndpoints, setSelEndpoints] = useState<Set<string>>(new Set());
  const [selFlows, setSelFlows] = useState<Set<string>>(new Set());
  const [selPrereqs, setSelPrereqs] = useState<Set<string>>(new Set());
  const [delUrls, setDelUrls] = useState<Set<string>>(new Set());
  const [apiKeyCreates, setApiKeyCreates] = useState<Map<string, ImportApiKeyCreate>>(new Map());

  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    if (!specContent.trim() && !specUrl.trim()) {
      setError("Paste a spec URL or browse to a spec file first.");
      return;
    }
    setPreviewing(true);
    setError(null);
    setPreview(null);
    try {
      const p = await previewSwaggerImport(props.project.id, {
        // A browsed file wins over a typed URL.
        specContent: specContent.trim() || undefined,
        specUrl: specContent.trim() ? undefined : specUrl.trim() || undefined,
        baseUrlOverride: baseUrlOverride.trim() || undefined,
        includeDeprecated,
      });
      setPreview(p);

      const defaultEnds = new Set(
        p.diff.endpoints
          .filter((e) => e.status === "new" || e.status === "drifted")
          .map((e) => e.identity),
      );
      setSelEndpoints(defaultEnds);
      setSelFlows(new Set(p.diff.flows.filter((f) => f.status === "new").map((f) => f.xMonFlowId)));
      setSelPrereqs(
        new Set(p.diff.prereqs.filter((pr) => pr.status === "new").map((pr) => pr.xMonPrereqId)),
      );
      setDelUrls(new Set());
      setApiKeyCreates(new Map());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      const result = await applySwaggerImport(props.project.id, {
        // Must match the source used at preview time so the same spec is applied.
        specContent: specContent.trim() || undefined,
        specUrl: specContent.trim() ? undefined : specUrl.trim() || undefined,
        selections: {
          endpointIdentities: Array.from(selEndpoints),
          flowIds: Array.from(selFlows),
          prereqIds: Array.from(selPrereqs),
          deleteUrlIds: Array.from(delUrls),
          deleteFlowIds: [],
          deletePrereqIds: [],
          apiKeyCreates: Array.from(apiKeyCreates.values()),
        },
        baseUrlOverride: baseUrlOverride.trim() || undefined,
        includeDeprecated,
      });
      const parts: string[] = [];
      if (result.createdUrls) parts.push(`${result.createdUrls} URLs`);
      if (result.updatedUrls) parts.push(`${result.updatedUrls} URLs updated`);
      if (result.createdFlows) parts.push(`${result.createdFlows} flows`);
      if (result.createdPrereqs) parts.push(`${result.createdPrereqs} prereqs`);
      if (result.createdApiKeys) parts.push(`${result.createdApiKeys} vault entries`);
      if (result.deletedUrls) parts.push(`${result.deletedUrls} URLs deleted`);
      const summary = parts.length ? `Imported: ${parts.join(", ")}.` : "Nothing changed.";
      if (result.errors.length) {
        props.onError?.(
          `Import completed with ${result.errors.length} issue(s): ${result.errors[0]}${result.errors.length > 1 ? " …" : ""}`,
        );
      }
      await props.onDone(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  function toggle(set: Set<string>, setSet: (s: Set<string>) => void, key: string) {
    const copy = new Set(set);
    if (copy.has(key)) copy.delete(key);
    else copy.add(key);
    setSet(copy);
  }

  function toggleAuthCreate(scheme: ImportAuthSchemePreview) {
    const copy = new Map(apiKeyCreates);
    if (copy.has(scheme.schemeId)) {
      copy.delete(scheme.schemeId);
    } else {
      const isBearer = scheme.type === "http-bearer";
      copy.set(scheme.schemeId, {
        schemeId: scheme.schemeId,
        name: scheme.schemeId,
        headerName: isBearer ? "Authorization" : scheme.headerName || "X-API-Key",
        headerPrefix: isBearer ? "Bearer " : "",
        value: "",
      });
    }
    setApiKeyCreates(copy);
  }

  function patchAuthCreate(schemeId: string, patch: Partial<ImportApiKeyCreate>) {
    const copy = new Map(apiKeyCreates);
    const existing = copy.get(schemeId);
    if (existing) {
      copy.set(schemeId, { ...existing, ...patch });
      setApiKeyCreates(copy);
    }
  }

  // ===== STEP 1: URL input =====
  if (!preview) {
    return (
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void handlePreview();
        }}
      >
        <Stepper active={1} />
        <p style={{ marginTop: 0, color: "var(--muted)", fontSize: "var(--text-base)" }}>
          Paste a Swagger / OpenAPI 3.x spec URL, or browse to a spec file on your computer —
          we'll create one Monitored URL per endpoint. If the spec was previously exported by
          this suite, your Flows and Prereqs will be round-tripped automatically.
        </p>
        <label className="field">
          <div className="field-head">
            <span className="field-label">Spec URL</span>
          </div>
          <input
            autoFocus
            type="url"
            placeholder="https://petstore3.swagger.io/api/v3/openapi.json"
            value={specUrl}
            onChange={(e) => {
              setSpecUrl(e.target.value);
              // Typing a URL clears a previously-browsed file (they're exclusive).
              if (e.target.value && specContent) {
                setSpecContent("");
                setFileName("");
              }
            }}
            disabled={!!specContent}
          />
        </label>

        {/* OR — browse to a local spec file (e.g. one you exported to your desktop). */}
        <div className="import-or">
          <span>or</span>
        </div>
        <label className="field">
          <div className="field-head">
            <span className="field-label">Import from a file</span>
            <span className="field-hint">Select a .yaml / .yml / .json OpenAPI 3.x file</span>
          </div>
          <div className="import-file-row">
            <input
              type="file"
              accept=".yaml,.yml,.json,application/json,text/yaml,application/x-yaml"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                  setError("File exceeds the 10MB limit.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setSpecContent(String(reader.result ?? ""));
                  setFileName(file.name);
                  setSpecUrl(""); // a file wins over a URL
                  setError(null);
                };
                reader.onerror = () => setError("Could not read that file.");
                reader.readAsText(file);
              }}
            />
            {fileName && (
              <span className="import-file-chip">
                📄 {fileName}
                <button
                  type="button"
                  className="import-file-clear"
                  title="Remove file"
                  onClick={() => {
                    setSpecContent("");
                    setFileName("");
                  }}
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        </label>
        <label className="field">
          <div className="field-head">
            <span className="field-label">Base URL override (optional)</span>
            <span className="field-hint">Used only if the spec has no servers block</span>
          </div>
          <input
            type="text"
            placeholder="https://api.example.com"
            value={baseUrlOverride}
            onChange={(e) => setBaseUrlOverride(e.target.value)}
          />
        </label>
        <div style={{ marginTop: "var(--s-2)" }}>
          <Switch
            checked={includeDeprecated}
            onChange={setIncludeDeprecated}
            label="Include deprecated operations"
            sub="Off by default — deprecated endpoints usually shouldn't be monitored"
          />
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => props.onDone()}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={previewing || (!specUrl.trim() && !specContent.trim())}
          >
            {previewing ? (
              <>
                <span className="spinner-inline" />
                {specContent ? "Reading spec…" : "Fetching spec…"}
              </>
            ) : (
              specContent ? "Read spec" : "Fetch spec"
            )}
          </button>
        </div>
      </form>
    );
  }

  // ===== STEP 2: Preview + selection =====
  const { diff, specMeta } = preview;
  const totalSelected = selEndpoints.size + selFlows.size + selPrereqs.size + delUrls.size;
  const isRoundTrip = specMeta.isRoundTrip;

  const apiKeyById = new Map(props.project.apiKeys.map((k) => [k.id, k]));

  const summaryParts: string[] = [];
  if (selEndpoints.size) summaryParts.push(`${selEndpoints.size} URLs`);
  if (selFlows.size) summaryParts.push(`${selFlows.size} flows`);
  if (selPrereqs.size) summaryParts.push(`${selPrereqs.size} prereqs`);
  if (apiKeyCreates.size) summaryParts.push(`${apiKeyCreates.size} vault entries`);
  if (delUrls.size) summaryParts.push(`${delUrls.size} URLs deleted`);

  return (
    <div className="form" style={{ maxHeight: "70vh", overflowY: "auto" }}>
      <Stepper active={applying ? 3 : 2} />

      {/* ---- HEADER BANNER ---- */}
      <div className="import-banner">
        <h4 className="import-banner-title">{specMeta.title}</h4>
        <div className="import-banner-meta">
          <span className="pill pending">v{specMeta.version}</span>
          {isRoundTrip && <span className="pill g-3xx">round-trip export</span>}
          <span className="pill pending">{diff.endpoints.length} endpoints</span>
        </div>
        <div className="import-banner-id">spec-id: {specMeta.specId}</div>
      </div>

      {diff.warnings.length > 0 && (
        <div className="import-warnings">
          {diff.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {/* ---- AUTH SCHEMES ---- */}
      <SectionHeader title="Auth schemes" total={diff.authSchemes.length} />
      {diff.authSchemes.length === 0 ? (
        <div className="empty-inline">No auth schemes declared in this spec.</div>
      ) : (
        <div className="import-auth-stack">
          {diff.authSchemes.map((s) => (
            <AuthSchemeCard
              key={s.schemeId}
              scheme={s}
              matchedName={s.matchedApiKeyId ? apiKeyById.get(s.matchedApiKeyId)?.name : undefined}
              draft={apiKeyCreates.get(s.schemeId)}
              onToggleCreate={() => toggleAuthCreate(s)}
              onPatchDraft={(p) => patchAuthCreate(s.schemeId, p)}
            />
          ))}
        </div>
      )}

      {/* ---- ENDPOINTS ---- */}
      <SectionHeader
        title="Endpoints"
        total={diff.endpoints.length}
        selected={selEndpoints.size}
      />
      <BulkActions
        all={diff.endpoints.map((e) => e.identity)}
        selected={selEndpoints}
        setSelected={setSelEndpoints}
      />
      <table className="import-table">
        <thead>
          <tr>
            <th className="col-check" />
            <th className="col-method">Method</th>
            <th>Path</th>
            <th>Auth</th>
            <th className="col-status">Status</th>
          </tr>
        </thead>
        <tbody>
          {diff.endpoints.map((e) => (
            <EndpointRow
              key={e.identity}
              endpoint={e}
              checked={selEndpoints.has(e.identity)}
              onToggle={() => toggle(selEndpoints, setSelEndpoints, e.identity)}
            />
          ))}
        </tbody>
      </table>

      {/* ---- FLOWS (round-trip only) ---- */}
      {isRoundTrip && diff.flows.length > 0 && (
        <>
          <SectionHeader title="Flows" total={diff.flows.length} selected={selFlows.size} />
          <BulkActions
            all={diff.flows.map((f) => f.xMonFlowId)}
            selected={selFlows}
            setSelected={setSelFlows}
          />
          <table className="import-table">
            <thead>
              <tr>
                <th className="col-check" />
                <th>Name</th>
                <th style={{ width: 80 }}>Steps</th>
                <th className="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {diff.flows.map((f) => (
                <FlowRow
                  key={f.xMonFlowId}
                  flow={f}
                  checked={selFlows.has(f.xMonFlowId)}
                  onToggle={() => toggle(selFlows, setSelFlows, f.xMonFlowId)}
                />
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ---- PREREQS (round-trip only) ---- */}
      {isRoundTrip && diff.prereqs.length > 0 && (
        <>
          <SectionHeader
            title="Prereqs"
            total={diff.prereqs.length}
            selected={selPrereqs.size}
          />
          <BulkActions
            all={diff.prereqs.map((p) => p.xMonPrereqId)}
            selected={selPrereqs}
            setSelected={setSelPrereqs}
          />
          <table className="import-table">
            <thead>
              <tr>
                <th className="col-check" />
                <th style={{ width: 40 }}>#</th>
                <th className="col-method">Method</th>
                <th>Path</th>
                <th className="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {diff.prereqs.map((p) => (
                <PrereqRow
                  key={p.xMonPrereqId}
                  prereq={p}
                  checked={selPrereqs.has(p.xMonPrereqId)}
                  onToggle={() => toggle(selPrereqs, setSelPrereqs, p.xMonPrereqId)}
                />
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ---- REMOVED FROM SPEC ---- */}
      {diff.removed.urls.length > 0 && (
        <>
          <SectionHeader
            title="Removed from spec"
            total={diff.removed.urls.length}
            selected={delUrls.size}
            destructive
          />
          <p
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--g-4xx)",
              margin: "0 0 var(--s-2)",
            }}
          >
            These URLs exist in the project but aren't in the current spec. Tick to delete.
          </p>
          <table className="import-table">
            <thead>
              <tr>
                <th className="col-check" />
                <th className="col-method">Method</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {diff.removed.urls.map((u) => (
                <tr key={u.id}>
                  <td className="check-cell">
                    <input
                      type="checkbox"
                      checked={delUrls.has(u.id)}
                      onChange={() => toggle(delUrls, setDelUrls, u.id)}
                    />
                  </td>
                  <td>
                    <MethodTag method={u.method} />
                  </td>
                  <td className="path-cell">{u.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {error && <div className="inline-error">{error}</div>}

      {/* ---- STICKY FOOTER ---- */}
      <div className="import-footer">
        <div className="import-footer-summary">
          {summaryParts.length ? (
            <>
              About to import: <strong>{summaryParts.join(" + ")}</strong>
            </>
          ) : (
            <>Nothing selected.</>
          )}
        </div>
        <div className="import-footer-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => setPreview(null)}
            disabled={applying}
          >
            ← Back
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => props.onDone()}
            disabled={applying}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void handleApply()}
            disabled={applying || totalSelected === 0}
          >
            {applying ? (
              <>
                <span className="spinner-inline" />
                Importing {totalSelected} item{totalSelected === 1 ? "" : "s"}…
              </>
            ) : (
              `Import ${totalSelected} item${totalSelected === 1 ? "" : "s"}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Sub-components =====

function Stepper(props: { active: 1 | 2 | 3 }) {
  return (
    <div className="import-stepper">
      <Step n={1} label="Spec URL" active={props.active === 1} done={props.active > 1} />
      <span className="import-step-sep">→</span>
      <Step n={2} label="Review" active={props.active === 2} done={props.active > 2} />
      <span className="import-step-sep">→</span>
      <Step n={3} label="Import" active={props.active === 3} />
    </div>
  );
}

function Step(props: { n: number; label: string; active?: boolean; done?: boolean }) {
  const cls = props.done
    ? "import-step done"
    : props.active
      ? "import-step active"
      : "import-step";
  return (
    <span className={cls}>
      <span className="import-step-num">{props.done ? "✓" : props.n}</span>
      {props.label}
    </span>
  );
}

function Switch(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span>
        {props.label}
        {props.sub && <span className="switch-label-sub">{props.sub}</span>}
      </span>
    </label>
  );
}

function SectionHeader(props: {
  title: string;
  total: number;
  selected?: number;
  destructive?: boolean;
}) {
  return (
    <div className="import-section-head">
      <h4 className="section-h">{props.title}</h4>
      {props.selected !== undefined && props.total > 0 && (
        <span className="import-section-count">
          <strong style={{ color: props.destructive ? "var(--g-5xx)" : undefined }}>
            {props.selected}
          </strong>{" "}
          of {props.total} selected
        </span>
      )}
      {props.selected === undefined && props.total > 0 && (
        <span className="import-section-count">
          <strong>{props.total}</strong>
        </span>
      )}
    </div>
  );
}

function BulkActions(props: {
  all: string[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
}) {
  if (props.all.length === 0) return null;
  const allSelected = props.all.every((k) => props.selected.has(k));
  const noneSelected = props.selected.size === 0;
  return (
    <div className="import-bulk">
      <button
        type="button"
        className="import-bulk-link"
        onClick={() => props.setSelected(new Set(props.all))}
        disabled={allSelected}
      >
        Select all
      </button>
      <span className="import-bulk-sep">·</span>
      <button
        type="button"
        className="import-bulk-link"
        onClick={() => props.setSelected(new Set())}
        disabled={noneSelected}
      >
        Select none
      </button>
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  new: "g-2xx",
  unchanged: "pending",
  drifted: "g-4xx",
  removed: "g-5xx",
};

function StatusPill(props: { status: ImportEndpointPreview["status"] }) {
  return <span className={`pill ${STATUS_PILL[props.status] || "pending"}`}>{props.status}</span>;
}

const METHOD_CLASS: Record<string, string> = {
  GET: "method-get",
  POST: "method-post",
  PUT: "method-put",
  PATCH: "method-patch",
};

function MethodTag(props: { method: string }) {
  const m = props.method.toUpperCase();
  const cls = METHOD_CLASS[m] || "method-get";
  return <span className={`method-tag ${cls}`}>{m}</span>;
}

function EndpointRow(props: {
  endpoint: ImportEndpointPreview;
  checked: boolean;
  onToggle: () => void;
}) {
  const e = props.endpoint;
  return (
    <tr className={e.deprecated ? "deprecated" : undefined}>
      <td className="check-cell">
        <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
      </td>
      <td>
        <MethodTag method={e.method} />
      </td>
      <td>
        <div className="path-cell">{e.pathTemplate}</div>
        {e.summary && <div className="path-cell-sub">{e.summary}</div>}
        {e.driftReason && <div className="path-cell-drift">drift: {e.driftReason}</div>}
      </td>
      <td className="auth-cell">{e.authSchemeId || "—"}</td>
      <td>
        <StatusPill status={e.status} />
      </td>
    </tr>
  );
}

function FlowRow(props: { flow: ImportFlowPreview; checked: boolean; onToggle: () => void }) {
  const f = props.flow;
  return (
    <tr>
      <td className="check-cell">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={props.onToggle}
          disabled={f.status === "unchanged"}
        />
      </td>
      <td>{f.name}</td>
      <td style={{ textAlign: "center" }}>{f.stepCount}</td>
      <td>
        <StatusPill status={f.status} />
      </td>
    </tr>
  );
}

function PrereqRow(props: {
  prereq: ImportPrereqPreview;
  checked: boolean;
  onToggle: () => void;
}) {
  const p = props.prereq;
  return (
    <tr>
      <td className="check-cell">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={props.onToggle}
          disabled={p.status === "unchanged"}
        />
      </td>
      <td>{p.position}</td>
      <td>
        <MethodTag method={p.method} />
      </td>
      <td className="path-cell">{p.pathTemplate}</td>
      <td>
        <StatusPill status={p.status} />
      </td>
    </tr>
  );
}

function AuthSchemeCard(props: {
  scheme: ImportAuthSchemePreview;
  matchedName?: string;
  draft: ImportApiKeyCreate | undefined;
  onToggleCreate: () => void;
  onPatchDraft: (p: Partial<ImportApiKeyCreate>) => void;
}) {
  const s = props.scheme;
  const matched = s.matchedApiKeyId !== null;
  const unsupported = s.type === "unsupported";
  const expanded = !!props.draft;

  const variant = matched
    ? "matched"
    : unsupported
      ? "unsupported"
      : expanded
        ? "expanded"
        : "";

  const typeLabel =
    s.type === "http-bearer"
      ? "HTTP Bearer token"
      : s.type === "apiKey-header"
        ? `API key in header${s.headerName ? ` (${s.headerName})` : ""}`
        : `${s.unsupportedKind} (unsupported)`;

  const icon = matched ? "✓" : unsupported ? "—" : "+";

  return (
    <div className={`import-auth-card ${variant}`}>
      <div className="import-auth-card-head">
        <div>
          <div className="import-auth-card-id">
            <span className="import-auth-card-icon">{icon}</span>
            {s.schemeId}
          </div>
          <div className="import-auth-card-type">{typeLabel}</div>
        </div>
        <div className="import-auth-card-status">
          {matched ? (
            <span className="pill g-2xx">matched by {s.matchReason}</span>
          ) : unsupported ? (
            <span className="pill pending">skipped</span>
          ) : expanded ? (
            <button
              type="button"
              className="import-auth-card-create-toggle cancel"
              onClick={props.onToggleCreate}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="import-auth-card-create-toggle"
              onClick={props.onToggleCreate}
            >
              + Create vault entry
            </button>
          )}
        </div>
      </div>

      {matched && props.matchedName && (
        <div className="import-auth-card-hint">
          Using existing vault entry: <strong>{props.matchedName}</strong>
        </div>
      )}

      {unsupported && (
        <div className="import-auth-card-hint">
          The vault model can only represent static-header auth (Bearer / API key / Basic). URLs
          tagged with this scheme will be imported without auth — you can manually attach a vault
          entry to each one from the URL list later.
        </div>
      )}

      {!matched && !unsupported && !expanded && (
        <div className="import-auth-card-hint">
          No matching vault entry found. Click <strong>+ Create vault entry</strong> to add one
          now, or import the URLs first and attach auth later.
        </div>
      )}

      {expanded && props.draft && (
        <div className="import-auth-card-form">
          <label className="field">
            <div className="field-head">
              <span className="field-label">Name</span>
            </div>
            <input
              type="text"
              value={props.draft.name}
              onChange={(e) => props.onPatchDraft({ name: e.target.value })}
              placeholder="What to call this in the vault"
            />
          </label>
          <label className="field">
            <div className="field-head">
              <span className="field-label">Header name</span>
            </div>
            <input
              type="text"
              value={props.draft.headerName}
              onChange={(e) => props.onPatchDraft({ headerName: e.target.value })}
              placeholder="Authorization"
            />
          </label>
          <label className="field">
            <div className="field-head">
              <span className="field-label">Header prefix</span>
              <span className="field-hint">e.g. "Bearer " — include trailing space</span>
            </div>
            <input
              type="text"
              value={props.draft.headerPrefix}
              onChange={(e) => props.onPatchDraft({ headerPrefix: e.target.value })}
              placeholder=""
            />
          </label>
          <label className="field field-full">
            <div className="field-head">
              <span className="field-label">Secret value</span>
              <span className="field-hint">Leave blank to fill in later from the vault page</span>
            </div>
            <input
              type="password"
              value={props.draft.value}
              onChange={(e) => props.onPatchDraft({ value: e.target.value })}
              placeholder="Paste your token or API key"
              autoComplete="off"
            />
          </label>
        </div>
      )}
    </div>
  );
}
