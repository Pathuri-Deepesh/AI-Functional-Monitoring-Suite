import { useEffect, useState } from "react";
import {
  addFlowStep,
  addPrereqStep,
  createFlow,
  deleteFlowStep,
  deletePrereqStep,
  updateFlow,
  updateFlowStep,
  updatePrereqStep,
} from "../api";
import type {
  Assertion,
  AssertionType,
  BodyType,
  Extraction,
  ExtractionSource,
  Flow,
  FlowStep,
  FlowWithSteps,
  HttpMethod,
  KeyValue,
  PrereqStep,
  Project,
  ProjectVariable,
} from "../types";

interface BaseProps {
  onDone: (msg?: string) => void | Promise<void>;
  onError?: (msg: string) => void;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH"];
const BODY_TYPES: { value: BodyType; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "No request body" },
  { value: "json", label: "JSON", hint: "application/json" },
  { value: "raw", label: "Raw", hint: "Plain text with custom Content-Type" },
  { value: "urlencoded", label: "x-www-form-urlencoded", hint: "key=value&foo=bar" },
  { value: "form", label: "Form-data", hint: "JSON list: [{key, value}]" },
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
// Create / edit flow metadata (name, interval, stop-on-failure)
// =============================================================
export function FlowEditorForm(props: BaseProps & { project: Project; flow?: Flow }) {
  const { project, flow } = props;
  const editing = !!flow;
  const [name, setName] = useState(flow?.name ?? "");
  const [description, setDescription] = useState(flow?.description ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState(flow?.intervalMinutes ?? 5);
  const [stopOnFailure, setStopOnFailure] = useState(flow?.stopOnFailure ?? true);
  const [enabled, setEnabled] = useState(flow?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        await updateFlow(flow!.id, { name, description, intervalMinutes, stopOnFailure, enabled });
        await props.onDone(`Flow "${name}" updated`);
      } else {
        await createFlow(project.id, { name, description, intervalMinutes, stopOnFailure });
        await props.onDone(`Flow "${name}" created`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Flow name" required>
        <input
          autoFocus
          type="text"
          placeholder="e.g. Login + Read campaigns"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
      <Field label="Description (optional)">
        <input
          type="text"
          placeholder="What does this flow validate?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="form-row">
        <Field label="Run every (min)" hint="Whole flow runs as one atomic sequence">
          <input
            type="number"
            min={1}
            max={1440}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value) || 5)}
          />
        </Field>
        <Field label="On failure" hint="Stop = skip remaining steps; Continue = run all anyway">
          <select
            value={stopOnFailure ? "stop" : "continue"}
            onChange={(e) => setStopOnFailure(e.target.value === "stop")}
          >
            <option value="stop">Stop on first failure (recommended)</option>
            <option value="continue">Continue on failure (diagnostic)</option>
          </select>
        </Field>
      </div>
      {editing && (
        <Field label="Enabled">
          <select value={enabled ? "yes" : "no"} onChange={(e) => setEnabled(e.target.value === "yes")}>
            <option value="yes">Enabled — flow runs on schedule</option>
            <option value="no">Disabled — flow won't run automatically</option>
          </select>
        </Field>
      )}
      {err && <div className="inline-error">{err}</div>}
      <div className="modal-actions">
        <button type="button" className="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Create flow"}
        </button>
      </div>
    </form>
  );
}

// =============================================================
// Add / edit a single Step inside a flow
// =============================================================
type StepTab = "basics" | "params" | "headers" | "body" | "assertions" | "extract" | "retry";

export function StepEditorForm(
  props: BaseProps & {
    flow: FlowWithSteps;
    project: Project;
    step?: FlowStep;
    projectVars?: ProjectVariable[];
  }
) {
  const { flow, project, step, projectVars } = props;
  const editing = !!step;
  const [url, setUrl] = useState(step?.url ?? "");
  const [method, setMethod] = useState<HttpMethod>(step?.method ?? "GET");
  const [description, setDescription] = useState(step?.description ?? "");
  const [apiKeyId, setApiKeyId] = useState(step?.apiKeyId ?? "");
  const [bodyType, setBodyType] = useState<BodyType>(step?.bodyType ?? "none");
  const [body, setBody] = useState(step?.body ?? "");
  const [bodyContentType, setBodyContentType] = useState(step?.bodyContentType || "text/plain");
  const [assertions, setAssertions] = useState<Assertion[]>(step?.assertions ?? []);
  const [customHeaders, setCustomHeaders] = useState<KeyValue[]>(step?.customHeaders ?? []);
  const [queryParams, setQueryParams] = useState<KeyValue[]>(step?.queryParams ?? []);
  const [extractions, setExtractions] = useState<Extraction[]>(step?.extractions ?? []);
  const [waitBeforeMs, setWaitBeforeMs] = useState(step?.waitBeforeMs ?? 0);
  const [maxRetries, setMaxRetries] = useState(step?.maxRetries ?? 0);
  const [retryBackoffMs, setRetryBackoffMs] = useState(step?.retryBackoffMs ?? 1000);
  const [tab, setTab] = useState<StepTab>("basics");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const bodyAllowed = method !== "GET";
  const headerCount = customHeaders.filter((h) => h.key.trim()).length;
  const paramCount = queryParams.filter((p) => p.key.trim()).length;
  const extractCount = extractions.filter((e) => e.saveAs.trim()).length;

  // Build list of variables available in {{...}}:
  //   1) Project-pool vars captured by the prereq chain (visible everywhere)
  //   2) Vars captured by earlier steps in THIS flow run
  const availableVars = (() => {
    const list: { name: string; from: string }[] = [];
    for (const v of projectVars ?? []) {
      list.push({ name: v.name, from: "prereq chain" });
    }
    for (const s of flow.steps) {
      if (step && s.id === step.id) break;
      for (const ex of s.extractions) {
        if (ex.saveAs.trim()) list.push({ name: ex.saveAs, from: `step ${s.position}` });
      }
    }
    return list;
  })();

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
        method,
        apiKeyId: apiKeyId || null,
        bodyType: method === "GET" ? "none" : bodyType,
        body: method === "GET" ? "" : body,
        bodyContentType: method === "GET" || bodyType !== "raw" ? "" : bodyContentType.trim(),
        assertions,
        customHeaders: customHeaders.filter((h) => h.key.trim()),
        queryParams: queryParams.filter((p) => p.key.trim()),
        extractions: extractions.filter((e) => e.saveAs.trim()),
        waitBeforeMs,
        maxRetries,
        retryBackoffMs,
      };
      if (editing) {
        await updateFlowStep(step!.id, payload);
        await props.onDone(`Step updated`);
      } else {
        await addFlowStep(flow.id, payload);
        await props.onDone(`Step added`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save step");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!step) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    await deleteFlowStep(step.id);
    await props.onDone(`Step deleted`);
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="builder-tabs">
        <Tab name="basics" current={tab} setTab={setTab}>Basics</Tab>
        <Tab name="params" current={tab} setTab={setTab}>Params{paramCount > 0 ? ` (${paramCount})` : ""}</Tab>
        <Tab name="headers" current={tab} setTab={setTab}>Headers{headerCount > 0 ? ` (${headerCount})` : ""}</Tab>
        <Tab name="body" current={tab} setTab={setTab} disabled={!bodyAllowed}>
          Body{bodyAllowed && bodyType !== "none" ? " ●" : ""}
        </Tab>
        <Tab name="assertions" current={tab} setTab={setTab}>
          Assertions{assertions.length > 0 ? ` (${assertions.length})` : ""}
        </Tab>
        <Tab name="extract" current={tab} setTab={setTab}>
          Extract{extractCount > 0 ? ` (${extractCount})` : ""}
        </Tab>
        <Tab name="retry" current={tab} setTab={setTab}>
          Retry / Wait
          {maxRetries > 0 || waitBeforeMs > 0 ? " ●" : ""}
        </Tab>
      </div>

      {availableVars.length > 0 && (
        <div className="vars-hint">
          <strong>Available variables</strong> (from earlier steps): {" "}
          {availableVars.map((v, i) => (
            <span key={i} className="var-chip">
              <code>{`{{${v.name}}}`}</code> <span className="muted small">· {v.from}</span>
            </span>
          ))}
        </div>
      )}

      {tab === "basics" && (
        <>
          <div className="url-input-row">
            <select className="method-select" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              autoFocus
              type="url"
              placeholder="https://api.example.com/endpoint"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <Field label="Description" hint="What does this step do?">
            <input
              type="text"
              placeholder="e.g. Authenticate user, then capture token"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="API key" hint="Pick a key from this project (optional)">
            <select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)}>
              <option value="">No API key</option>
              {project.apiKeys.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </Field>
        </>
      )}

      {tab === "params" && (
        <KvTableEditor
          rows={queryParams}
          setRows={setQueryParams}
          keyPlaceholder="Param name"
          valuePlaceholder="Param value (use {{var}} to substitute)"
          hint="Appended to URL as ?key=value. Use {{variableName}} from earlier steps."
        />
      )}

      {tab === "headers" && (
        <KvTableEditor
          rows={customHeaders}
          setRows={setCustomHeaders}
          keyPlaceholder="Header name"
          valuePlaceholder="Header value (use {{var}} to substitute)"
          hint="Sent on every check. Use {{variableName}} for dynamic values."
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
        />
      )}
      {tab === "body" && !bodyAllowed && (
        <div className="empty-inline">GET requests don't carry a body.</div>
      )}

      {tab === "assertions" && (
        <AssertionsEditor assertions={assertions} setAssertions={setAssertions} />
      )}

      {tab === "extract" && (
        <ExtractionsEditor extractions={extractions} setExtractions={setExtractions} />
      )}

      {tab === "retry" && (
        <RetryWaitEditor
          waitBeforeMs={waitBeforeMs}
          setWaitBeforeMs={setWaitBeforeMs}
          maxRetries={maxRetries}
          setMaxRetries={setMaxRetries}
          retryBackoffMs={retryBackoffMs}
          setRetryBackoffMs={setRetryBackoffMs}
        />
      )}

      {err && <div className="inline-error">{err}</div>}

      <div className="modal-actions">
        {editing && (
          <button
            type="button"
            className={`ghost destructive ${confirmingDelete ? "confirming" : ""}`}
            onClick={handleDelete}
          >
            {confirmingDelete ? "Click again to confirm" : "Delete step"}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save step" : "Add step"}
        </button>
      </div>
    </form>
  );
}

function Tab(props: { name: StepTab; current: StepTab; setTab: (t: StepTab) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`tab ${props.current === props.name ? "active" : ""} ${props.disabled ? "disabled" : ""}`}
      onClick={() => !props.disabled && props.setTab(props.name)}
    >
      {props.children}
    </button>
  );
}

// =============================================================
// Extractions editor
// =============================================================
function ExtractionsEditor(props: { extractions: Extraction[]; setExtractions: (e: Extraction[]) => void }) {
  const { extractions, setExtractions } = props;
  function add() {
    setExtractions([
      ...extractions,
      { id: crypto.randomUUID(), source: "body", path: "$.", saveAs: "", ttlSeconds: null },
    ]);
  }
  function update(id: string, patch: Partial<Extraction>) {
    setExtractions(extractions.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  function remove(id: string) {
    setExtractions(extractions.filter((e) => e.id !== id));
  }
  return (
    <>
      <p className="sub small">
        Capture values from this step's response so later steps can use them as <code>{`{{name}}`}</code>.
      </p>
      {extractions.length === 0 && (
        <div className="empty-inline">No extractions yet. Click "Add" to capture a value.</div>
      )}
      {extractions.map((ex) => (
        <div key={ex.id} className="extraction-row">
          <select
            className="ex-source"
            value={ex.source}
            onChange={(e) => update(ex.id, { source: e.target.value as ExtractionSource })}
          >
            <option value="body">From body (JSONPath)</option>
            <option value="header">From header</option>
            <option value="status">From status code</option>
          </select>
          {ex.source !== "status" && (
            <input
              type="text"
              className="ex-path"
              placeholder={ex.source === "body" ? "$.auth.token" : "X-Session-ID"}
              value={ex.path}
              onChange={(e) => update(ex.id, { path: e.target.value })}
            />
          )}
          <span className="muted small">→</span>
          <input
            type="text"
            className="ex-name"
            placeholder="variable_name"
            value={ex.saveAs}
            onChange={(e) => update(ex.id, { saveAs: e.target.value })}
          />
          <label className="ex-ttl" title="Optional: cache this value across runs for N seconds">
            <span className="muted small">TTL</span>
            <input
              type="number"
              min={0}
              placeholder="0"
              value={ex.ttlSeconds ?? ""}
              onChange={(e) => update(ex.id, { ttlSeconds: e.target.value ? Number(e.target.value) : null })}
              style={{ width: 70 }}
            />
            <span className="muted small">sec</span>
          </label>
          <button type="button" className="ghost destructive small" onClick={() => remove(ex.id)}>×</button>
        </div>
      ))}
      <button type="button" className="ghost small" style={{ marginTop: 8 }} onClick={add}>
        + Add extraction
      </button>
    </>
  );
}

// =============================================================
// Retry + Wait editor
// =============================================================
function RetryWaitEditor(props: {
  waitBeforeMs: number;
  setWaitBeforeMs: (v: number) => void;
  maxRetries: number;
  setMaxRetries: (v: number) => void;
  retryBackoffMs: number;
  setRetryBackoffMs: (v: number) => void;
}) {
  const { waitBeforeMs, setWaitBeforeMs, maxRetries, setMaxRetries, retryBackoffMs, setRetryBackoffMs } = props;
  return (
    <>
      <Field label="Wait before this step (ms)" hint="Useful for async APIs that need a moment to process. Default 0.">
        <input
          type="number"
          min={0}
          max={60_000}
          step={500}
          value={waitBeforeMs}
          onChange={(e) => setWaitBeforeMs(Math.max(0, Number(e.target.value) || 0))}
        />
      </Field>
      <div className="form-row">
        <Field label="Max retries on failure" hint="0–5 attempts. Kills false alerts from network blips.">
          <input
            type="number"
            min={0}
            max={5}
            value={maxRetries}
            onChange={(e) => setMaxRetries(Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
          />
        </Field>
        <Field label="Initial backoff (ms)" hint="Doubled after each failed retry (max 30s).">
          <input
            type="number"
            min={100}
            max={30000}
            step={100}
            value={retryBackoffMs}
            onChange={(e) => setRetryBackoffMs(Math.max(100, Math.min(30000, Number(e.target.value) || 1000)))}
          />
        </Field>
      </div>
    </>
  );
}

// =============================================================
// Reusable subcomponents (mirror those in forms.tsx — kept local to avoid cross-import)
// =============================================================
function Field(props: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
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

function KvTableEditor(props: {
  rows: KeyValue[];
  setRows: (next: KeyValue[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  hint: string;
}) {
  const { rows, setRows, keyPlaceholder, valuePlaceholder, hint } = props;
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
            <input type="text" placeholder={keyPlaceholder} value={r.key} onChange={(e) => update(i, { key: e.target.value })} />
            <input type="text" placeholder={valuePlaceholder} value={r.value} onChange={(e) => update(i, { value: e.target.value })} />
            <button type="button" className="ghost small" onClick={() => remove(i)} aria-label="Remove row">×</button>
          </div>
        ))}
        <button type="button" className="ghost small" onClick={add} style={{ marginTop: 6, alignSelf: "flex-start" }}>
          + Add row
        </button>
      </div>
    </>
  );
}

function BodyEditor(props: {
  bodyType: BodyType;
  setBodyType: (t: BodyType) => void;
  body: string;
  setBody: (b: string) => void;
  bodyContentType: string;
  setBodyContentType: (c: string) => void;
}) {
  const { bodyType, setBodyType, body, setBody, bodyContentType, setBodyContentType } = props;
  const isPreset = RAW_CONTENT_TYPE_PRESETS.some((p) => p.value && p.value === bodyContentType);
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
        <Field label="JSON body" hint="application/json. Use {{var}} for substitution.">
          <textarea
            className="code-input"
            spellCheck={false}
            placeholder='{ "name": "{{user_id}}" }'
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
          />
        </Field>
      )}
      {bodyType === "raw" && (
        <>
          <Field label="Content-Type preset">
            <div className="body-type-row">
              {RAW_CONTENT_TYPE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`body-type-btn ${(p.value && bodyContentType === p.value) || (p.value === "" && !isPreset) ? "active" : ""}`}
                  onClick={() => setBodyContentType(p.value || "")}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
          {!isPreset && (
            <Field label="Custom Content-Type">
              <input type="text" placeholder="text/plain" value={bodyContentType} onChange={(e) => setBodyContentType(e.target.value)} />
            </Field>
          )}
          <Field label="Raw body" hint={`Sent as ${bodyContentType || "text/plain"}`}>
            <textarea className="code-input" spellCheck={false} value={body} onChange={(e) => setBody(e.target.value)} rows={10} />
          </Field>
        </>
      )}
      {bodyType === "urlencoded" && (
        <Field label="URL-encoded body" hint="key=value&foo=bar">
          <textarea className="code-input" spellCheck={false} placeholder="username={{user}}&password=demo" value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        </Field>
      )}
      {bodyType === "form" && (
        <Field label="Form fields (JSON array)" hint='[{"key":"name","value":"x"}]'>
          <textarea className="code-input" spellCheck={false} value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
        </Field>
      )}
      {bodyType === "none" && <div className="empty-inline">No body will be sent.</div>}
    </>
  );
}

// =============================================================
// Prereq step editor — mirrors StepEditorForm but for project-level
// prerequisite chains. Vars captured here flow into the project pool
// (visible to every URL and Flow) when a TTL is set.
// =============================================================
export function PrereqStepEditorForm(
  props: BaseProps & {
    project: Project;
    step?: PrereqStep;
    /** Steps already in the chain — used to surface vars they capture. */
    siblingSteps: PrereqStep[];
  }
) {
  const { project, step, siblingSteps } = props;
  const editing = !!step;
  const [url, setUrl] = useState(step?.url ?? "");
  const [method, setMethod] = useState<HttpMethod>(step?.method ?? "POST");
  const [description, setDescription] = useState(step?.description ?? "");
  const [apiKeyId, setApiKeyId] = useState(step?.apiKeyId ?? "");
  const [bodyType, setBodyType] = useState<BodyType>(step?.bodyType ?? "json");
  const [body, setBody] = useState(step?.body ?? "");
  const [bodyContentType, setBodyContentType] = useState(step?.bodyContentType || "text/plain");
  const [assertions, setAssertions] = useState<Assertion[]>(step?.assertions ?? []);
  const [customHeaders, setCustomHeaders] = useState<KeyValue[]>(step?.customHeaders ?? []);
  const [queryParams, setQueryParams] = useState<KeyValue[]>(step?.queryParams ?? []);
  const [extractions, setExtractions] = useState<Extraction[]>(step?.extractions ?? []);
  const [waitBeforeMs, setWaitBeforeMs] = useState(step?.waitBeforeMs ?? 0);
  const [maxRetries, setMaxRetries] = useState(step?.maxRetries ?? 0);
  const [retryBackoffMs, setRetryBackoffMs] = useState(step?.retryBackoffMs ?? 1000);
  const [tab, setTab] = useState<StepTab>("basics");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const bodyAllowed = method !== "GET";
  const headerCount = customHeaders.filter((h) => h.key.trim()).length;
  const paramCount = queryParams.filter((p) => p.key.trim()).length;
  const extractCount = extractions.filter((e) => e.saveAs.trim()).length;

  // Vars captured by previous prereq steps in this chain
  const availableVars = (() => {
    const list: { name: string; from: string }[] = [];
    for (const s of siblingSteps) {
      if (step && s.id === step.id) break;
      for (const ex of s.extractions) {
        if (ex.saveAs.trim()) list.push({ name: ex.saveAs, from: `prereq step ${s.position}` });
      }
    }
    return list;
  })();

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
        method,
        apiKeyId: apiKeyId || null,
        bodyType: method === "GET" ? "none" as BodyType : bodyType,
        body: method === "GET" ? "" : body,
        bodyContentType: method === "GET" || bodyType !== "raw" ? "" : bodyContentType.trim(),
        assertions,
        customHeaders: customHeaders.filter((h) => h.key.trim()),
        queryParams: queryParams.filter((p) => p.key.trim()),
        extractions: extractions.filter((e) => e.saveAs.trim()),
        waitBeforeMs,
        maxRetries,
        retryBackoffMs,
      };
      if (editing) {
        await updatePrereqStep(step!.id, payload);
        await props.onDone(`Prereq step updated`);
      } else {
        await addPrereqStep(project.id, payload);
        await props.onDone(`Prereq step added`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save step");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!step) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    await deletePrereqStep(step.id);
    await props.onDone(`Prereq step deleted`);
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="builder-tabs">
        <Tab name="basics" current={tab} setTab={setTab}>Basics</Tab>
        <Tab name="params" current={tab} setTab={setTab}>Params{paramCount > 0 ? ` (${paramCount})` : ""}</Tab>
        <Tab name="headers" current={tab} setTab={setTab}>Headers{headerCount > 0 ? ` (${headerCount})` : ""}</Tab>
        <Tab name="body" current={tab} setTab={setTab} disabled={!bodyAllowed}>
          Body{bodyAllowed && bodyType !== "none" ? " ●" : ""}
        </Tab>
        <Tab name="assertions" current={tab} setTab={setTab}>
          Assertions{assertions.length > 0 ? ` (${assertions.length})` : ""}
        </Tab>
        <Tab name="extract" current={tab} setTab={setTab}>
          Extract{extractCount > 0 ? ` (${extractCount})` : ""}
        </Tab>
        <Tab name="retry" current={tab} setTab={setTab}>
          Retry / Wait
          {maxRetries > 0 || waitBeforeMs > 0 ? " ●" : ""}
        </Tab>
      </div>

      {availableVars.length > 0 && (
        <div className="vars-hint">
          <strong>Available variables</strong> (from earlier prereq steps): {" "}
          {availableVars.map((v, i) => (
            <span key={i} className="var-chip">
              <code>{`{{${v.name}}}`}</code> <span className="muted small">· {v.from}</span>
            </span>
          ))}
        </div>
      )}

      {tab === "basics" && (
        <>
          <div className="url-input-row">
            <select className="method-select" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              autoFocus
              type="url"
              placeholder="https://api.example.com/auth/login"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <Field label="Description" hint="What does this prereq step do?">
            <input
              type="text"
              placeholder="e.g. Log in as service account and capture token"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="API key" hint="Optional — usually not needed for the login step itself">
            <select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)}>
              <option value="">No API key</option>
              {project.apiKeys.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </Field>
          <div className="vars-hint" style={{ marginTop: 12 }}>
            <strong>Tip:</strong> add an extraction on the <em>Extract</em> tab with a TTL to publish
            the captured value to the project pool. Every URL and Flow can then use it as <code>{`{{name}}`}</code>.
          </div>
        </>
      )}

      {tab === "params" && (
        <KvTableEditor
          rows={queryParams}
          setRows={setQueryParams}
          keyPlaceholder="Param name"
          valuePlaceholder="Param value (use {{var}} to substitute)"
          hint="Appended to URL as ?key=value."
        />
      )}

      {tab === "headers" && (
        <KvTableEditor
          rows={customHeaders}
          setRows={setCustomHeaders}
          keyPlaceholder="Header name"
          valuePlaceholder="Header value (use {{var}} to substitute)"
          hint="Sent on every check."
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
        />
      )}
      {tab === "body" && !bodyAllowed && (
        <div className="empty-inline">GET requests don't carry a body.</div>
      )}

      {tab === "assertions" && (
        <AssertionsEditor assertions={assertions} setAssertions={setAssertions} />
      )}

      {tab === "extract" && (
        <ExtractionsEditor extractions={extractions} setExtractions={setExtractions} />
      )}

      {tab === "retry" && (
        <RetryWaitEditor
          waitBeforeMs={waitBeforeMs}
          setWaitBeforeMs={setWaitBeforeMs}
          maxRetries={maxRetries}
          setMaxRetries={setMaxRetries}
          retryBackoffMs={retryBackoffMs}
          setRetryBackoffMs={setRetryBackoffMs}
        />
      )}

      {err && <div className="inline-error">{err}</div>}

      <div className="modal-actions">
        {editing && (
          <button
            type="button"
            className={`ghost destructive ${confirmingDelete ? "confirming" : ""}`}
            onClick={handleDelete}
          >
            {confirmingDelete ? "Click again to confirm" : "Delete step"}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save step" : "Add step"}
        </button>
      </div>
    </form>
  );
}

function AssertionsEditor(props: { assertions: Assertion[]; setAssertions: (a: Assertion[]) => void }) {
  const { assertions, setAssertions } = props;
  function add(type: AssertionType) {
    const defaults: Record<AssertionType, Record<string, any>> = {
      "status-equals": { value: 200 },
      "status-in-range": { min: 200, max: 299 },
      "latency-under": { ms: 1000 },
      "body-contains": { text: "" },
    };
    setAssertions([...assertions, { id: crypto.randomUUID(), type, config: defaults[type] }]);
  }
  function update(id: string, patch: Partial<Assertion["config"]>) {
    setAssertions(assertions.map((a) => (a.id === id ? { ...a, config: { ...a.config, ...patch } } : a)));
  }
  function remove(id: string) {
    setAssertions(assertions.filter((a) => a.id !== id));
  }
  return (
    <>
      <p className="sub small">
        Pass = step OK. Fail any assertion = step failed.{" "}
        <span className="muted">
          <strong>Tip:</strong> use <code>{`{{var}}`}</code> in "body has" to track a value
          that changes each run (e.g. a session token from prereqs).
        </span>
      </p>
      {assertions.length === 0 && <div className="empty-inline">No assertions — only status code 2xx/3xx counts as OK.</div>}
      {assertions.map((a) => (
        <div key={a.id} className="assertion-row">
          <span className="assertion-type-tag">
            {a.type === "status-equals" && "status ="}
            {a.type === "status-in-range" && "status in"}
            {a.type === "latency-under" && "latency <"}
            {a.type === "body-contains" && "body has"}
          </span>
          {a.type === "status-equals" && (
            <input type="number" value={a.config.value ?? 200} onChange={(e) => update(a.id, { value: Number(e.target.value) })} style={{ width: 90 }} />
          )}
          {a.type === "status-in-range" && (
            <>
              <input type="number" value={a.config.min ?? 200} onChange={(e) => update(a.id, { min: Number(e.target.value) })} style={{ width: 80 }} />
              <span className="muted small">to</span>
              <input type="number" value={a.config.max ?? 299} onChange={(e) => update(a.id, { max: Number(e.target.value) })} style={{ width: 80 }} />
            </>
          )}
          {a.type === "latency-under" && (
            <>
              <input type="number" value={a.config.ms ?? 1000} onChange={(e) => update(a.id, { ms: Number(e.target.value) })} style={{ width: 100 }} />
              <span className="muted small">ms</span>
            </>
          )}
          {a.type === "body-contains" && (
            <input
              type="text"
              placeholder='text or {{var}}'
              value={a.config.text ?? ""}
              onChange={(e) => update(a.id, { text: e.target.value })}
              style={{ flex: 1 }}
            />
          )}
          <button type="button" className="ghost destructive small" onClick={() => remove(a.id)}>×</button>
        </div>
      ))}
      <div className="add-assertion-row">
        <span className="muted small">Add:</span>
        <button type="button" className="ghost small" onClick={() => add("status-equals")}>+ status equals</button>
        <button type="button" className="ghost small" onClick={() => add("status-in-range")}>+ status range</button>
        <button type="button" className="ghost small" onClick={() => add("latency-under")}>+ latency under</button>
        <button type="button" className="ghost small" onClick={() => add("body-contains")}>+ body contains</button>
      </div>
    </>
  );
}
