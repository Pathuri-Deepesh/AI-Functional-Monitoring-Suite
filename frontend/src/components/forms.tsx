import { useEffect, useState } from "react";
import {
  addApiKey,
  addUrl,
  createProject,
  fetchProjectVariables,
  removeApiKey,
  updateProject,
  updateUrl,
} from "../api";
import type {
  Assertion,
  AssertionType,
  BodyType,
  HttpMethod,
  KeyValue,
  MonitoredUrl,
  Project,
  ProjectVariable,
} from "../types";
import { BinaryBodyEditor } from "./BinaryBodyEditor";
import { ConfirmDialog } from "./Modal";
import { useTheme, type ThemePref } from "../theme";
import { slugifyKeyName } from "../slugify";

export type SettingsPanel = "general" | "api-keys" | "notifications" | "appearance";

// =============================================================
// AvailableVarsPanel — reusable grouped {{var}} reference panel.
// Used by AddUrlForm (standalone URLs), StepEditorForm (flow steps), and
// PrereqStepEditorForm (prereq steps) so the user can see every variable
// they're allowed to reference, grouped by source: API Key Vault,
// Prerequisites, Step 1, Step 2, …
// =============================================================
export interface VarChip {
  name: string;
  tooltip?: string;
}
export interface VarGroup {
  label: string;
  icon?: string;
  vars: VarChip[];
}

export function AvailableVarsPanel(props: { groups: VarGroup[] }) {
  const nonEmpty = props.groups.filter((g) => g.vars.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="vars-panel">
      <div className="vars-panel-head">
        <strong>Available variables</strong>
        <span className="muted small">
          use as <code>{`{{name}}`}</code> in any URL, body, header, or query param below
        </span>
      </div>
      {nonEmpty.map((g) => (
        <div className="vars-group" key={g.label}>
          <span className="vars-group-label">
            {g.icon && (
              <span className="vars-group-icon" aria-hidden>
                {g.icon}
              </span>
            )}
            {g.label}
          </span>
          <div className="vars-group-chips">
            {g.vars.map((v) => (
              <span key={v.name} className="var-chip" title={v.tooltip}>
                <code>{`{{${v.name}}}`}</code>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Build the standard API-key group from a project's vault. Each key surfaces
 * as `{{slugified_name}}` (Phase 1.27.4); the tooltip preserves the
 * user-entered name so they can map the slug back to the vault entry.
 */
export function apiKeyVarsGroup(apiKeys: Project["apiKeys"]): VarGroup {
  return {
    label: "API Key Vault",
    icon: "🔑",
    vars: apiKeys.map((k) => ({
      name: slugifyKeyName(k.name),
      tooltip: `from vault key "${k.name}" — auto-injected into ${k.headerName} too`,
    })),
  };
}

/**
 * Build the Prerequisites group from the project-pool variables captured by
 * the prereq chain (the Phase 1.19 project_variable_cache).
 */
export function prereqVarsGroup(projectVars: ProjectVariable[]): VarGroup {
  return {
    label: "Prerequisites",
    icon: "🔄",
    vars: projectVars.map((v) => ({
      name: v.name,
      tooltip: v.expiresAt
        ? `from prereq chain · expires ${new Date(v.expiresAt).toLocaleString()}`
        : `from prereq chain · no TTL`,
    })),
  };
}

interface BaseProps {
  onDone: (msg?: string) => void | Promise<void>;
  onError?: (msg: string) => void;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH"];
const BODY_TYPES: { value: BodyType; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "No request body" },
  { value: "json", label: "JSON", hint: "application/json" },
  { value: "raw", label: "Raw", hint: "Plain text with custom Content-Type (XML, HTML, JS, etc.)" },
  { value: "urlencoded", label: "x-www-form-urlencoded", hint: "key=value&foo=bar" },
  { value: "form", label: "Form-data", hint: "JSON list: [{key, value}]" },
  { value: "binary", label: "Binary", hint: "Upload a file (image, PDF, etc.)" },
];

const RAW_CONTENT_TYPE_PRESETS: { value: string; label: string }[] = [
  { value: "text/plain", label: "Text" },
  { value: "application/javascript", label: "JavaScript" },
  { value: "application/xml", label: "XML" },
  { value: "text/html", label: "HTML" },
  { value: "application/yaml", label: "YAML" },
  { value: "", label: "Custom…" },
];

// =============================================================
// Create project
// =============================================================
export function CreateProjectForm(props: BaseProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createProject({ name: name.trim(), description: description.trim() });
      await props.onDone(`Project "${name.trim()}" created`);
    } catch (e) {
      props.onError?.(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Project name" required>
        <input
          autoFocus
          type="text"
          placeholder="e.g. Campaign Service"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          placeholder="What does this project monitor?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

// =============================================================
// Add / Edit URL — Postman-style request builder.
// When `url` prop is provided, the form pre-populates and submits as an edit.
// =============================================================
type BuilderTab = "basics" | "params" | "headers" | "body" | "assertions" | "retry";

export function AddUrlForm(props: BaseProps & { project: Project; url?: MonitoredUrl }) {
  const editing = props.url != null;
  const initial = props.url;

  const [url, setUrl] = useState(initial?.url ?? "");
  const [method, setMethod] = useState<HttpMethod>(initial?.method ?? "GET");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [apiKeyId, setApiKeyId] = useState(initial?.apiKeyId ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState(initial?.intervalMinutes ?? 5);
  const [bodyType, setBodyType] = useState<BodyType>(initial?.bodyType ?? "none");
  const [body, setBody] = useState(initial?.body ?? "");
  const [bodyContentType, setBodyContentType] = useState(
    initial?.bodyContentType?.trim() ? initial.bodyContentType : "text/plain"
  );
  const [assertions, setAssertions] = useState<Assertion[]>(initial?.assertions ?? []);
  const [customHeaders, setCustomHeaders] = useState<KeyValue[]>(initial?.customHeaders ?? []);
  const [queryParams, setQueryParams] = useState<KeyValue[]>(initial?.queryParams ?? []);
  const [waitBeforeMs, setWaitBeforeMs] = useState(initial?.waitBeforeMs ?? 0);
  const [maxRetries, setMaxRetries] = useState(initial?.maxRetries ?? 0);
  const [retryBackoffMs, setRetryBackoffMs] = useState(initial?.retryBackoffMs ?? 0);
  const [tab, setTab] = useState<BuilderTab>("basics");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fetch prereq-captured project vars on mount so the AvailableVarsPanel
  // can surface them alongside the vault keys. Cheap (<10ms) and the user
  // would otherwise have no discoverable way to know {{auth_token}} exists.
  const [projectVars, setProjectVars] = useState<ProjectVariable[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchProjectVariables(props.project.id)
      .then((vars) => {
        if (!cancelled) setProjectVars(vars);
      })
      .catch(() => {
        /* non-fatal — panel just hides the prereq group */
      });
    return () => {
      cancelled = true;
    };
  }, [props.project.id]);

  const varGroups: VarGroup[] = [
    apiKeyVarsGroup(props.project.apiKeys),
    prereqVarsGroup(projectVars),
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setTab("basics");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        url: url.trim(),
        description: description.trim(),
        apiKeyId: apiKeyId || null,
        intervalMinutes,
        method,
        bodyType: (method === "GET" ? "none" : bodyType) as BodyType,
        body: method === "GET" ? "" : body,
        bodyContentType: method === "GET" || bodyType !== "raw" ? "" : bodyContentType.trim(),
        assertions,
        customHeaders: customHeaders.filter((h) => h.key.trim()),
        queryParams: queryParams.filter((p) => p.key.trim()),
        waitBeforeMs: Math.max(0, Math.min(60_000, Math.floor(waitBeforeMs))),
        maxRetries: Math.max(0, Math.min(10, Math.floor(maxRetries))),
        retryBackoffMs: Math.max(0, Math.min(60_000, Math.floor(retryBackoffMs))),
      };
      if (editing && initial) {
        await updateUrl(initial.id, payload);
        await props.onDone(`Updated ${method} ${url.trim()}`);
      } else {
        await addUrl(props.project.id, payload);
        await props.onDone(`Added ${method} ${url.trim()}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : editing ? "Failed to save URL" : "Failed to add URL");
    } finally {
      setBusy(false);
    }
  }

  const bodyAllowed = method !== "GET";
  const headerCount = customHeaders.filter((h) => h.key.trim()).length;
  const paramCount = queryParams.filter((p) => p.key.trim()).length;
  const retryConfigured = waitBeforeMs > 0 || maxRetries > 0;

  return (
    <form className="form" onSubmit={submit}>
      <AvailableVarsPanel groups={varGroups} />
      <div className="builder-tabs">
        <button type="button" className={`tab ${tab === "basics" ? "active" : ""}`} onClick={() => setTab("basics")}>
          Basics
        </button>
        <button
          type="button"
          className={`tab ${tab === "params" ? "active" : ""}`}
          onClick={() => setTab("params")}
        >
          Params{paramCount > 0 ? ` (${paramCount})` : ""}
        </button>
        <button
          type="button"
          className={`tab ${tab === "headers" ? "active" : ""}`}
          onClick={() => setTab("headers")}
        >
          Headers{headerCount > 0 ? ` (${headerCount})` : ""}
        </button>
        <button
          type="button"
          className={`tab ${tab === "body" ? "active" : ""} ${!bodyAllowed ? "disabled" : ""}`}
          onClick={() => bodyAllowed && setTab("body")}
        >
          Body{bodyAllowed && bodyType !== "none" ? " ●" : ""}
        </button>
        <button
          type="button"
          className={`tab ${tab === "assertions" ? "active" : ""}`}
          onClick={() => setTab("assertions")}
        >
          Assertions{assertions.length > 0 ? ` (${assertions.length})` : ""}
        </button>
        <button
          type="button"
          className={`tab ${tab === "retry" ? "active" : ""}`}
          onClick={() => setTab("retry")}
        >
          Retry / Wait{retryConfigured ? " ●" : ""}
        </button>
      </div>

      {tab === "basics" && (
        <>
          <div className="url-input-row">
            <select className="method-select" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              autoFocus
              type="url"
              placeholder="https://api.example.com/health"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <Field label="Description" hint="What does this endpoint do?">
            <input
              type="text"
              placeholder="e.g. Campaign health check"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="form-row">
            <Field label="API key" hint="Pick one of this project's keys">
              <select value={apiKeyId ?? ""} onChange={(e) => setApiKeyId(e.target.value)}>
                <option value="">No API key</option>
                {props.project.apiKeys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Check every (min)" hint="1 to 1440">
              <input
                type="number"
                min={1}
                max={1440}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value) || 5)}
              />
            </Field>
          </div>
        </>
      )}

      {tab === "params" && (
        <KvTableEditor
          rows={queryParams}
          setRows={setQueryParams}
          keyPlaceholder="Param name"
          valuePlaceholder="Param value"
          hint="Appended to the URL as ?key=value&key=value"
          example="e.g. q=monitor&page=1 → ?q=monitor&page=1"
        />
      )}

      {tab === "headers" && (
        <KvTableEditor
          rows={customHeaders}
          setRows={setCustomHeaders}
          keyPlaceholder="Header name"
          valuePlaceholder="Header value"
          hint="Sent on every check. Auth headers from API keys take priority."
          example="e.g. X-Tenant-ID: 42 · Accept: application/json"
        />
      )}

      {tab === "body" && bodyAllowed && (
        <BodyEditor
          bodyType={bodyType}
          setBodyType={setBodyType}
          body={body}
          setBody={setBody}
          bodyContentType={bodyContentType}
          setBodyContentType={setBodyContentType}
          projectId={props.project.id}
        />
      )}

      {tab === "body" && !bodyAllowed && (
        <div className="empty-inline">GET requests don't carry a body — switch the method to POST/PUT/PATCH.</div>
      )}

      {tab === "assertions" && (
        <AssertionsEditor assertions={assertions} setAssertions={setAssertions} />
      )}

      {tab === "retry" && (
        <>
          <p className="sub small">
            Mask flaky endpoints. <strong>Wait before</strong> delays the first attempt (useful for
            eventually-consistent APIs). <strong>Max retries</strong> = extra attempts after a
            failure. Backoff doubles after each retry. 4xx responses are NOT retried.
          </p>
          <div className="form-row">
            <Field label="Wait before (ms)" hint="0 = no delay; max 60000">
              <input
                type="number"
                min={0}
                max={60_000}
                value={waitBeforeMs}
                onChange={(e) => setWaitBeforeMs(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Max retries" hint="0 = single-shot; max 10">
              <input
                type="number"
                min={0}
                max={10}
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value) || 0)}
              />
            </Field>
          </div>
          <Field
            label="Initial backoff (ms)"
            hint="Doubled after each failed retry (e.g. 500 → 500 / 1000 / 2000 / 4000…)"
          >
            <input
              type="number"
              min={0}
              max={60_000}
              value={retryBackoffMs}
              onChange={(e) => setRetryBackoffMs(Number(e.target.value) || 0)}
            />
          </Field>
        </>
      )}

      {err && <div className="inline-error">{err}</div>}

      <div className="modal-actions">
        <button type="button" className="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Start monitoring"}
        </button>
      </div>
    </form>
  );
}

// =============================================================
// Body Editor (Postman-like)
// =============================================================
function BodyEditor(props: {
  bodyType: BodyType;
  setBodyType: (t: BodyType) => void;
  body: string;
  setBody: (b: string) => void;
  bodyContentType: string;
  setBodyContentType: (c: string) => void;
  projectId: string;
}) {
  const { bodyType, setBodyType, body, setBody, bodyContentType, setBodyContentType, projectId } = props;

  // Is the current content-type one of the presets?
  const isPreset = RAW_CONTENT_TYPE_PRESETS.some(
    (p) => p.value && p.value === bodyContentType
  );

  return (
    <>
      <Field label="Body type">
        <div className="body-type-row">
          {BODY_TYPES.map((bt) => (
            <button
              key={bt.value}
              type="button"
              className={`body-type-btn ${bodyType === bt.value ? "active" : ""}`}
              onClick={() => setBodyType(bt.value)}
              title={bt.hint}
            >
              {bt.label}
            </button>
          ))}
        </div>
      </Field>

      {bodyType === "json" && (
        <Field label="JSON body" hint="application/json">
          <textarea
            className="code-input"
            spellCheck={false}
            placeholder='{ "name": "test", "qty": 1 }'
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
          />
        </Field>
      )}

      {bodyType === "raw" && (
        <>
          <Field label="Content-Type preset" hint="Sets the Content-Type header sent with this body">
            <div className="body-type-row">
              {RAW_CONTENT_TYPE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`body-type-btn ${
                    (p.value && bodyContentType === p.value) ||
                    (p.value === "" && !isPreset)
                      ? "active"
                      : ""
                  }`}
                  onClick={() => setBodyContentType(p.value || "")}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          {!isPreset && (
            <Field label="Custom Content-Type" hint="e.g. application/csv, image/svg+xml">
              <input
                type="text"
                placeholder="text/plain"
                value={bodyContentType}
                onChange={(e) => setBodyContentType(e.target.value)}
              />
            </Field>
          )}
          <Field label="Raw body" hint={`Sent as ${bodyContentType || "text/plain"}`}>
            <textarea
              className="code-input"
              spellCheck={false}
              placeholder={rawPlaceholder(bodyContentType)}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
            />
          </Field>
        </>
      )}

      {bodyType === "urlencoded" && (
        <Field label="URL-encoded body" hint="key=value&foo=bar">
          <textarea
            className="code-input"
            spellCheck={false}
            placeholder="username=test&password=demo"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
          />
        </Field>
      )}

      {bodyType === "form" && (
        <FormFieldsEditor body={body} setBody={setBody} />
      )}

      {bodyType === "binary" && (
        <BinaryBodyEditor body={body} setBody={setBody} projectId={projectId} />
      )}

      {bodyType === "none" && (
        <div className="empty-inline">No body will be sent.</div>
      )}
    </>
  );
}

function rawPlaceholder(ct: string): string {
  if (ct.includes("xml")) return "<?xml version=\"1.0\"?>\n<request>\n  <action>create</action>\n</request>";
  if (ct.includes("html")) return "<html>\n  <body>Hello</body>\n</html>";
  if (ct.includes("javascript")) return "console.log('hello');";
  if (ct.includes("yaml")) return "name: test\nqty: 1";
  return "Type your raw body here…";
}

function FormFieldsEditor(props: { body: string; setBody: (b: string) => void }) {
  const initial: { key: string; value: string }[] = (() => {
    try {
      return JSON.parse(props.body);
    } catch {
      return [{ key: "", value: "" }];
    }
  })();
  const [fields, setFields] = useState<{ key: string; value: string }[]>(
    Array.isArray(initial) && initial.length > 0 ? initial : [{ key: "", value: "" }]
  );

  function update(next: { key: string; value: string }[]) {
    setFields(next);
    props.setBody(JSON.stringify(next.filter((f) => f.key)));
  }

  return (
    <Field label="Form fields" hint="Sent as application/x-www-form-urlencoded">
      <div className="form-fields-table">
        {fields.map((f, i) => (
          <div className="form-field-row" key={i}>
            <input
              placeholder="key"
              value={f.key}
              onChange={(e) => update(fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            />
            <input
              placeholder="value"
              value={f.value}
              onChange={(e) => update(fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <button
              type="button"
              className="ghost small"
              onClick={() => update(fields.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="ghost small" onClick={() => update([...fields, { key: "", value: "" }])}>
          + Add field
        </button>
      </div>
    </Field>
  );
}

// =============================================================
// Assertions Editor (simple v1)
// =============================================================
function AssertionsEditor(props: { assertions: Assertion[]; setAssertions: (a: Assertion[]) => void }) {
  const { assertions, setAssertions } = props;

  function add(type: AssertionType) {
    const defaults: Record<AssertionType, Record<string, any>> = {
      "status-equals": { value: 200 },
      "status-in-range": { min: 200, max: 299 },
      "latency-under": { ms: 1000 },
      "body-contains": { text: "" },
    };
    setAssertions([
      ...assertions,
      { id: crypto.randomUUID(), type, config: defaults[type] },
    ]);
  }

  function update(id: string, patch: Partial<Assertion["config"]>) {
    setAssertions(
      assertions.map((a) => (a.id === id ? { ...a, config: { ...a.config, ...patch } } : a))
    );
  }

  function remove(id: string) {
    setAssertions(assertions.filter((a) => a.id !== id));
  }

  return (
    <>
      <p className="sub small">
        Assertions run after every check. The URL is "OK" only if the status is good <em>and</em> all assertions pass.
      </p>

      {assertions.length === 0 && (
        <div className="empty-inline">No assertions yet — just status code checks will be used.</div>
      )}

      {assertions.map((a) => (
        <div key={a.id} className="assertion-row">
          <span className="assertion-type-tag">{assertionLabel(a.type)}</span>
          {a.type === "status-equals" && (
            <input
              type="number"
              value={a.config.value ?? 200}
              onChange={(e) => update(a.id, { value: Number(e.target.value) })}
              style={{ width: 90 }}
            />
          )}
          {a.type === "status-in-range" && (
            <>
              <input
                type="number"
                value={a.config.min ?? 200}
                onChange={(e) => update(a.id, { min: Number(e.target.value) })}
                style={{ width: 80 }}
              />
              <span className="muted small">to</span>
              <input
                type="number"
                value={a.config.max ?? 299}
                onChange={(e) => update(a.id, { max: Number(e.target.value) })}
                style={{ width: 80 }}
              />
            </>
          )}
          {a.type === "latency-under" && (
            <>
              <input
                type="number"
                value={a.config.ms ?? 1000}
                onChange={(e) => update(a.id, { ms: Number(e.target.value) })}
                style={{ width: 100 }}
              />
              <span className="muted small">ms</span>
            </>
          )}
          {a.type === "body-contains" && (
            <input
              type="text"
              placeholder="text to find in response"
              value={a.config.text ?? ""}
              onChange={(e) => update(a.id, { text: e.target.value })}
              style={{ flex: 1 }}
            />
          )}
          <button type="button" className="ghost destructive small" onClick={() => remove(a.id)}>
            ×
          </button>
        </div>
      ))}

      <div className="add-assertion-row">
        <span className="muted small">Add assertion:</span>
        <button type="button" className="ghost small" onClick={() => add("status-equals")}>
          + Status equals
        </button>
        <button type="button" className="ghost small" onClick={() => add("status-in-range")}>
          + Status in range
        </button>
        <button type="button" className="ghost small" onClick={() => add("latency-under")}>
          + Latency under
        </button>
        <button type="button" className="ghost small" onClick={() => add("body-contains")}>
          + Body contains
        </button>
      </div>
    </>
  );
}

function assertionLabel(type: AssertionType): string {
  switch (type) {
    case "status-equals":
      return "status =";
    case "status-in-range":
      return "status in";
    case "latency-under":
      return "latency <";
    case "body-contains":
      return "body has";
    default:
      return type;
  }
}

// =============================================================
// API Key Manager
// =============================================================
export function ApiKeyManagerForm(
  props: BaseProps & { project: Project; onClose?: () => void }
) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [headerPrefix, setHeaderPrefix] = useState("Bearer ");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);
  // When set, the in-app ConfirmDialog is shown for this key. Replaces the
  // native window.confirm() that used to fire here — same flow, polished UX.
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const [removingKey, setRemovingKey] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addApiKey(props.project.id, { name, value, headerName, headerPrefix });
      setName("");
      setValue("");
      setKeysVersion((v) => v + 1);
      await props.onDone(`Added key "${name}"`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add key");
    } finally {
      setBusy(false);
    }
  }

  async function performRemove() {
    if (!confirmRemove) return;
    const { id, name } = confirmRemove;
    setRemovingKey(true);
    try {
      await removeApiKey(props.project.id, id);
      setKeysVersion((v) => v + 1);
      await props.onDone(`Removed key "${name}"`);
    } finally {
      setRemovingKey(false);
      setConfirmRemove(null);
    }
  }

  return (
    <div className="form">
      <h4 className="section-h">Existing keys ({props.project.apiKeys.length})</h4>
      {props.project.apiKeys.length === 0 ? (
        <div className="empty-inline">No keys yet. Add one below.</div>
      ) : (
        <div className="key-list">
          {props.project.apiKeys.map((k) => (
            <div className="key-row" key={k.id}>
              <div>
                <div className="key-name">{k.name}</div>
                <div className="key-meta">
                  <code>
                    {k.headerName}: {k.headerPrefix}
                    {maskKey(k.value)}
                  </code>
                </div>
                <div className="key-meta" style={{ marginTop: 4 }}>
                  Use as: <code>{`{{${slugifyKeyName(k.name)}}}`}</code>
                </div>
              </div>
              <button
                type="button"
                className="ghost destructive small"
                onClick={() => setConfirmRemove({ id: k.id, name: k.name })}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <h4 className="section-h">Add a new key</h4>
      <p className="sub small" style={{ marginTop: -4, marginBottom: 12, color: "var(--muted)" }}>
        Auto-injected into the configured header on every request. Also available
        as <code>{`{{slugified_name}}`}</code> in any URL, body, header, or query
        param across this project's URLs, flows, and prereq steps.
      </p>
      {/*
        IMPORTANT: this form looks like a login form to browsers (text input +
        password input next to each other), so Chrome/Edge/Safari try to
        autofill it from saved credentials AFTER our setName('')/setValue('')
        clear runs — bypassing React's controlled inputs by writing directly
        to the DOM. Three defenses, all needed:
          1. autoComplete='off' on the form (broad hint)
          2. Specific autoComplete values per input (the real fix on Chrome):
             - 'one-time-code' / 'off' on name, 'new-password' on the secret
          3. key={keysVersion} on the form to remount it after each add/remove,
             which discards any browser-injected DOM state for free.
      */}
      <form onSubmit={add} key={keysVersion} autoComplete="off">
        {/* Honeypot fields the browser will autofill INTO instead of our real
            inputs (off-screen, no React state binding, ignored on submit). */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          style={{ display: "none" }}
          tabIndex={-1}
          aria-hidden
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          style={{ display: "none" }}
          tabIndex={-1}
          aria-hidden
        />

        <Field
          label="Key name"
          hint={
            name.trim()
              ? `Variable: {{${slugifyKeyName(name)}}}`
              : "A label so you can tell keys apart"
          }
        >
          <input
            type="text"
            name="apikey_label"
            autoComplete="off"
            data-lpignore="true"
            data-form-type="other"
            placeholder="e.g. Production"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Key value" hint="The actual secret token from the API provider">
          <input
            type="password"
            name="apikey_secret"
            autoComplete="new-password"
            data-lpignore="true"
            data-form-type="other"
            placeholder="paste your secret"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field label="Header name">
            <input
              type="text"
              name="apikey_header_name"
              autoComplete="off"
              value={headerName}
              onChange={(e) => setHeaderName(e.target.value)}
            />
          </Field>
          <Field label="Prefix" hint="e.g. 'Bearer ' (with trailing space)">
            <input
              type="text"
              name="apikey_header_prefix"
              autoComplete="off"
              value={headerPrefix}
              onChange={(e) => setHeaderPrefix(e.target.value)}
            />
          </Field>
        </div>

        {err && <div className="inline-error">{err}</div>}

        <div className="modal-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => (props.onClose ? props.onClose() : props.onDone())}
          >
            Done
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Adding…" : "Add key"}
          </button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove API key?"
        message={
          confirmRemove
            ? `Remove key "${confirmRemove.name}"? URLs using it will lose authentication on their next check.`
            : ""
        }
        confirmLabel="Remove key"
        destructive
        busy={removingKey}
        busyLabel="Removing…"
        onConfirm={performRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

// =============================================================
// Settings — 2-pane layout (left menu + right panel).
// `onDone(msg?)` = action succeeded (toast + refresh, stay on page).
// `onClose()`    = user wants to leave (closes modal OR navigates back, depending on host).
// Panels: General · API Keys · Notifications · Appearance.
// =============================================================
export function SettingsForm(
  props: BaseProps & {
    project: Project;
    initialPanel?: SettingsPanel;
    onClose: () => void;
    onPanelChange?: (panel: SettingsPanel) => void;
  }
) {
  const [panel, setPanel] = useState<SettingsPanel>(props.initialPanel ?? "general");

  // If the caller re-opens settings with a different initial panel, honor it.
  useEffect(() => {
    if (props.initialPanel) setPanel(props.initialPanel);
  }, [props.initialPanel, props.project.id]);

  function selectPanel(p: SettingsPanel) {
    setPanel(p);
    props.onPanelChange?.(p);
  }

  const panelProps = {
    project: props.project,
    onDone: props.onDone,
    onClose: props.onClose,
    onError: props.onError,
  };

  return (
    <div className="settings-shell">
      <nav className="settings-menu">
        <SettingsMenuItem
          icon="⚙"
          label="General"
          active={panel === "general"}
          onClick={() => selectPanel("general")}
        />
        <SettingsMenuItem
          icon="🔑"
          label="API Keys"
          active={panel === "api-keys"}
          onClick={() => selectPanel("api-keys")}
        />
        <SettingsMenuItem
          icon="🔔"
          label="Notifications"
          active={panel === "notifications"}
          onClick={() => selectPanel("notifications")}
        />
        <SettingsMenuItem
          icon="🎨"
          label="Appearance"
          active={panel === "appearance"}
          onClick={() => selectPanel("appearance")}
        />
      </nav>

      <section className="settings-panel">
        {panel === "general" && <GeneralPanel {...panelProps} />}
        {panel === "api-keys" && (
          <>
            <h4 className="settings-panel-title">API Keys</h4>
            <ApiKeyManagerForm
              project={props.project}
              onDone={props.onDone}
              onClose={props.onClose}
              onError={props.onError}
            />
          </>
        )}
        {panel === "notifications" && <NotificationsPanel {...panelProps} />}
        {panel === "appearance" && <AppearancePanel onClose={props.onClose} />}
      </section>
    </div>
  );
}

/**
 * Page-mode wrapper for SettingsForm. Renders a back button + title above the
 * shell so it reads as a dedicated page (not a modal) when mounted into the
 * main content area.
 */
export function SettingsPage(props: {
  project: Project;
  initialPanel?: SettingsPanel;
  onBack: () => void;
  onDone: (msg?: string) => void | Promise<void>;
  onError?: (msg: string) => void;
  onPanelChange?: (panel: SettingsPanel) => void;
}) {
  return (
    <main className="main settings-page">
      <div className="settings-page-header">
        <button className="ghost" onClick={props.onBack}>
          ← Back to {props.project.name}
        </button>
        <div>
          <h1 className="settings-page-title">Project settings</h1>
          <p className="settings-page-sub">{props.project.name}</p>
        </div>
      </div>
      <SettingsForm
        project={props.project}
        initialPanel={props.initialPanel}
        onPanelChange={props.onPanelChange}
        onDone={props.onDone}
        onClose={props.onBack}
        onError={props.onError}
      />
    </main>
  );
}

function SettingsMenuItem(props: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-menu-item ${props.active ? "active" : ""}`}
      onClick={props.onClick}
    >
      <span className="settings-menu-icon" aria-hidden>
        {props.icon}
      </span>
      {props.label}
    </button>
  );
}

// ----- General panel: name + description ---------------------------------
function GeneralPanel(
  props: BaseProps & { project: Project; onClose: () => void }
) {
  const [name, setName] = useState(props.project.name ?? "");
  const [description, setDescription] = useState(props.project.description ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(props.project.name ?? "");
    setDescription(props.project.description ?? "");
  }, [props.project.id, props.project.name, props.project.description]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await updateProject(props.project.id, {
        name: name.trim(),
        description: description.trim(),
      });
      await props.onDone("Project details saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <h4 className="settings-panel-title">General</h4>
      <Field label="Project name" required>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      {err && <div className="inline-error">{err}</div>}

      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onClose}>
          Close
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ----- Channel picker: dropdown to flip between General + Latency editors --
// Keeps BOTH textareas' state alive in the parent — only the selected one is
// rendered. Save still persists both. Per user request: "dont show both fields,
// show only the selected one which we will be selecting in a dropdown".
/**
 * Phase 1.27.13 — NotificationChannelEditor unifies Slack + Email behind a
 * single General/Latency pill selector. Picking a pill swaps BOTH the slack
 * webhook input and the recipients textarea below it. Mirrors the backend's
 * dual-channel routing model (slack + email both pick by failure category).
 */
function NotificationChannelEditor(props: {
  generalSlack: string;
  latencySlack: string;
  generalEmails: string;
  latencyEmails: string;
  onChangeGeneralSlack: (v: string) => void;
  onChangeLatencySlack: (v: string) => void;
  onChangeGeneralEmails: (v: string) => void;
  onChangeLatencyEmails: (v: string) => void;
}) {
  type Channel = "general" | "latency";
  const [channel, setChannel] = useState<Channel>("general");

  const generalEmailCount = countRecipients(props.generalEmails);
  const latencyEmailCount = countRecipients(props.latencyEmails);
  const generalSlackOn = (props.generalSlack ?? "").trim().length > 0;
  const latencySlackOn = (props.latencySlack ?? "").trim().length > 0;

  function slackSubFor(active: "general" | "latency"): string {
    if (active === "general") {
      return generalSlackOn ? "slack on" : "no slack";
    }
    if (latencySlackOn) return "slack on";
    return generalSlackOn ? "slack → general" : "no slack";
  }

  function emailSubFor(active: "general" | "latency"): string {
    const n = active === "general" ? generalEmailCount : latencyEmailCount;
    if (n === 0 && active === "latency") {
      return generalEmailCount > 0 ? "emails → general" : "no emails";
    }
    return `${n} ${n === 1 ? "email" : "emails"}`;
  }

  const pills: Array<{ value: Channel; title: string }> = [
    { value: "general", title: "General" },
    { value: "latency", title: "Latency" },
  ];

  return (
    <>
      <div className="notif-channel-pills" role="tablist" aria-label="Notification channel">
        {pills.map((p) => {
          const active = channel === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`notif-channel-pill ${active ? "active" : ""}`}
              onClick={() => setChannel(p.value)}
            >
              <span className="pill-title">{p.title}</span>
              <span className="pill-sub">
                {slackSubFor(p.value)} · {emailSubFor(p.value)}
              </span>
            </button>
          );
        })}
      </div>

      <p className="channel-info-line" style={{ marginTop: 0 }}>
        {channel === "general" ? (
          <>
            <strong>General channel</strong>
            <span>· any non-latency failure + Snapshot/Report</span>
          </>
        ) : (
          <>
            <strong>Latency channel</strong>
            <span>· only `latency-under` assertion failures</span>
          </>
        )}
      </p>

      {channel === "general" ? (
        <>
          <Field
            label="Slack webhook URL (General)"
            hint="Used for instant single-URL/flow failure alerts on non-latency failures + audit summaries. Leave empty to disable Slack for this channel."
          >
            <input
              type="text"
              placeholder="https://hooks.slack.com/services/..."
              value={props.generalSlack}
              onChange={(e) => props.onChangeGeneralSlack(e.target.value)}
            />
          </Field>
          <Field
            label="Email recipients (General)"
            hint="Comma / semicolon / newline separated. Sent on 4xx, 5xx, network errors, body-contains, status-assertion failures + Snapshot/Report button. SES must be configured in backend .env."
          >
            <textarea
              rows={5}
              placeholder="oncall@example.com, alice@example.com"
              value={props.generalEmails}
              onChange={(e) => props.onChangeGeneralEmails(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label="Slack webhook URL (Latency)"
            hint="Only used when a failure was caused solely by a `latency-under` assertion. Leave empty to send latency Slack alerts to the General webhook."
          >
            <input
              type="text"
              placeholder="https://hooks.slack.com/services/..."
              value={props.latencySlack}
              onChange={(e) => props.onChangeLatencySlack(e.target.value)}
            />
          </Field>
          <Field
            label="Email recipients (Latency)"
            hint="Only used when a failure was caused solely by a `latency-under` assertion. Leave empty to send latency emails to the General list."
          >
            <textarea
              rows={5}
              placeholder="perf-owners@example.com"
              value={props.latencyEmails}
              onChange={(e) => props.onChangeLatencyEmails(e.target.value)}
            />
          </Field>
        </>
      )}
    </>
  );
}

function countRecipients(raw: string): number {
  if (!raw) return 0;
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

// ----- Notifications panel: Slack + email recipients (general + latency) -
function NotificationsPanel(
  props: BaseProps & { project: Project; onClose: () => void }
) {
  // `?? ""` guards: if the backend hasn't shipped the new
  // latency_failure_emails column yet (e.g. you forgot to restart `npm run dev`),
  // `props.project.latencyFailureEmails` is undefined → without the fallback,
  // .trim() throws at save time and silently swallows the WHOLE save.
  const [slackWebhook, setSlackWebhook] = useState(
    props.project.slackWebhookUrl ?? ""
  );
  const [latencySlackWebhook, setLatencySlackWebhook] = useState(
    props.project.latencySlackWebhookUrl ?? ""
  );
  const [notificationEmails, setNotificationEmails] = useState(
    props.project.notificationEmails ?? ""
  );
  const [latencyFailureEmails, setLatencyFailureEmails] = useState(
    props.project.latencyFailureEmails ?? ""
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync when the underlying project values change (after a save+refresh
  // round-trip) — not just on project switch. Without this, a save would
  // toast success but the textarea would keep showing the pre-save value.
  useEffect(() => {
    setSlackWebhook(props.project.slackWebhookUrl ?? "");
    setLatencySlackWebhook(props.project.latencySlackWebhookUrl ?? "");
    setNotificationEmails(props.project.notificationEmails ?? "");
    setLatencyFailureEmails(props.project.latencyFailureEmails ?? "");
  }, [
    props.project.id,
    props.project.slackWebhookUrl,
    props.project.latencySlackWebhookUrl,
    props.project.notificationEmails,
    props.project.latencyFailureEmails,
  ]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const slackTrim = (slackWebhook ?? "").trim();
      const latencySlackTrim = (latencySlackWebhook ?? "").trim();
      const notifTrim = (notificationEmails ?? "").trim();
      const latencyTrim = (latencyFailureEmails ?? "").trim();

      const updated = await updateProject(props.project.id, {
        slackWebhookUrl: slackTrim,
        latencySlackWebhookUrl: latencySlackTrim,
        notificationEmails: notifTrim,
        latencyFailureEmails: latencyTrim,
      });

      // Verify the backend actually round-tripped what we sent. If the user
      // is running a backend that was started BEFORE the latency_failure_emails
      // column migration (Phase 1.27.2) — for example, an older `npm run dev`
      // session that's still alive — the field is silently dropped at the SQL
      // layer and `updated.latencyFailureEmails` comes back as an empty string
      // even though save reported success. Catch that here so the user knows
      // they need to restart the backend instead of staring at a vanishing
      // textarea and assuming the frontend is broken.
      const got = (updated.latencyFailureEmails ?? "").trim();
      if (latencyTrim && got !== latencyTrim) {
        throw new Error(
          `Backend didn't persist the Latency emails field. Sent "${latencyTrim}" but received "${got}". ` +
            `This almost always means the backend was started before the column migration ran. ` +
            `Stop the backend (Ctrl+C in the backend terminal) and run "npm run dev" again.`
        );
      }
      // Same round-trip check for the Phase 1.27.13 latency slack column.
      const gotSlack = (updated.latencySlackWebhookUrl ?? "").trim();
      if (latencySlackTrim && gotSlack !== latencySlackTrim) {
        throw new Error(
          `Backend didn't persist the Latency Slack webhook. Sent "${latencySlackTrim}" but received "${gotSlack}". ` +
            `This almost always means the backend was started before the column migration ran. ` +
            `Stop the backend (Ctrl+C in the backend terminal) and run "npm run dev" again.`
        );
      }

      // Sync local state immediately from the server response, so we don't
      // depend on the next 3-second poll catching up before the user navigates
      // away. props re-flow on the next refresh will then be a no-op.
      setSlackWebhook(updated.slackWebhookUrl ?? "");
      setLatencySlackWebhook(updated.latencySlackWebhookUrl ?? "");
      setNotificationEmails(updated.notificationEmails ?? "");
      setLatencyFailureEmails(updated.latencyFailureEmails ?? "");

      await props.onDone("Notification settings saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <h4 className="settings-panel-title">Notifications</h4>
      <p className="sub small" style={{ marginTop: -4, marginBottom: 12, color: "var(--muted)" }}>
        Pick a channel below to edit its Slack webhook and email recipients
        together. Latency-only failures use the Latency channel when populated;
        everything else uses General.
      </p>

      <NotificationChannelEditor
        generalSlack={slackWebhook}
        latencySlack={latencySlackWebhook}
        generalEmails={notificationEmails}
        latencyEmails={latencyFailureEmails}
        onChangeGeneralSlack={setSlackWebhook}
        onChangeLatencySlack={setLatencySlackWebhook}
        onChangeGeneralEmails={setNotificationEmails}
        onChangeLatencyEmails={setLatencyFailureEmails}
      />

      {err && <div className="inline-error">{err}</div>}

      <div className="modal-actions">
        <button type="button" className="ghost" onClick={props.onClose}>
          Close
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ----- Appearance panel: theme toggle ------------------------------------
function AppearancePanel(props: { onClose: () => void }) {
  const [pref, setPref, resolved] = useTheme();

  const options: { value: ThemePref; icon: string; label: string; sub: string }[] = [
    { value: "system", icon: "💻", label: "System", sub: "Follow OS preference" },
    { value: "light", icon: "☀", label: "Light", sub: "Bright surfaces" },
    { value: "dark", icon: "🌙", label: "Dark", sub: "Low-glare surfaces" },
  ];

  return (
    <div className="form">
      <h4 className="settings-panel-title">Appearance</h4>

      <Field
        label="Theme"
        hint={
          pref === "system"
            ? `Following OS (currently ${resolved})`
            : "Manual override — won't follow OS changes"
        }
      >
        <div className="theme-picker">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`theme-option ${pref === o.value ? "active" : ""}`}
              onClick={() => setPref(o.value)}
            >
              <span className="theme-option-icon" aria-hidden>
                {o.icon}
              </span>
              <span className="theme-option-label">{o.label}</span>
              <span className="theme-option-sub">{o.sub}</span>
            </button>
          ))}
        </div>
      </Field>

      <div className="modal-actions">
        <button type="button" className="primary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

// =============================================================
// Shared field wrapper
// =============================================================
function Field(props: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <div className="field-head">
        <span className="field-label">
          {props.label}
          {props.required && <span className="required">*</span>}
        </span>
        {props.hint && <span className="field-hint">{props.hint}</span>}
      </div>
      {props.children}
    </label>
  );
}

function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "••••";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

// =============================================================
// Reusable key-value table editor (for headers + query params)
// =============================================================
function KvTableEditor(props: {
  rows: KeyValue[];
  setRows: (next: KeyValue[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  hint: string;
  example: string;
}) {
  const { rows, setRows, keyPlaceholder, valuePlaceholder, hint, example } = props;
  const display = rows.length > 0 ? rows : [{ key: "", value: "" }];

  function update(idx: number, patch: Partial<KeyValue>) {
    const next = display.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    setRows(next.filter((r, i) => i < next.length - 1 || r.key.trim() || r.value.trim()));
  }
  function remove(idx: number) {
    setRows(display.filter((_, i) => i !== idx));
  }
  function add() {
    setRows([...rows, { key: "", value: "" }]);
  }

  return (
    <>
      <p className="sub small">{hint}</p>
      <div className="kv-table">
        <div className="kv-row kv-head">
          <span>Key</span>
          <span>Value</span>
          <span></span>
        </div>
        {display.map((r, i) => (
          <div className="kv-row" key={i}>
            <input
              type="text"
              placeholder={keyPlaceholder}
              value={r.key}
              onChange={(e) => update(i, { key: e.target.value })}
            />
            <input
              type="text"
              placeholder={valuePlaceholder}
              value={r.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
            <button type="button" className="ghost small" onClick={() => remove(i)} aria-label="Remove row">
              ×
            </button>
          </div>
        ))}
        <button type="button" className="ghost small" onClick={add} style={{ marginTop: 6, alignSelf: "flex-start" }}>
          + Add row
        </button>
      </div>
      <p className="sub small" style={{ marginTop: 8, color: "var(--muted-2)" }}>
        {example}
      </p>
    </>
  );
}
