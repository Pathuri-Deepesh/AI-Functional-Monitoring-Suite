import { useEffect, useState } from "react";
import { addApiKey, addUrl, createProject, removeApiKey, updateProject } from "../api";
import type { Assertion, AssertionType, BodyType, HttpMethod, KeyValue, Project } from "../types";

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
// Add URL — Postman-style request builder
// =============================================================
type BuilderTab = "basics" | "params" | "headers" | "body" | "assertions";

export function AddUrlForm(props: BaseProps & { project: Project }) {
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [description, setDescription] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [bodyType, setBodyType] = useState<BodyType>("none");
  const [body, setBody] = useState("");
  const [bodyContentType, setBodyContentType] = useState("text/plain");
  const [assertions, setAssertions] = useState<Assertion[]>([]);
  const [customHeaders, setCustomHeaders] = useState<KeyValue[]>([]);
  const [queryParams, setQueryParams] = useState<KeyValue[]>([]);
  const [tab, setTab] = useState<BuilderTab>("basics");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      setTab("basics");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await addUrl(props.project.id, {
        url: url.trim(),
        description: description.trim(),
        apiKeyId: apiKeyId || null,
        intervalMinutes,
        method,
        bodyType: method === "GET" ? "none" : bodyType,
        body: method === "GET" ? "" : body,
        bodyContentType: method === "GET" || bodyType !== "raw" ? "" : bodyContentType.trim(),
        assertions,
        customHeaders: customHeaders.filter((h) => h.key.trim()),
        queryParams: queryParams.filter((p) => p.key.trim()),
      });
      await props.onDone(`Added ${method} ${url.trim()}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add URL");
    } finally {
      setBusy(false);
    }
  }

  const bodyAllowed = method !== "GET";
  const headerCount = customHeaders.filter((h) => h.key.trim()).length;
  const paramCount = queryParams.filter((p) => p.key.trim()).length;

  return (
    <form className="form" onSubmit={submit}>
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
              <select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)}>
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
        />
      )}

      {tab === "body" && !bodyAllowed && (
        <div className="empty-inline">GET requests don't carry a body — switch the method to POST/PUT/PATCH.</div>
      )}

      {tab === "assertions" && (
        <AssertionsEditor assertions={assertions} setAssertions={setAssertions} />
      )}

      {err && <div className="inline-error">{err}</div>}

      <div className="modal-actions">
        <button type="button" className="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Adding…" : "Start monitoring"}
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
}) {
  const { bodyType, setBodyType, body, setBody, bodyContentType, setBodyContentType } = props;

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
export function ApiKeyManagerForm(props: BaseProps & { project: Project }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [headerPrefix, setHeaderPrefix] = useState("Bearer ");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);

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

  async function remove(keyId: string, keyName: string) {
    if (!window.confirm(`Remove key "${keyName}"? URLs using it will lose authentication.`)) return;
    await removeApiKey(props.project.id, keyId);
    setKeysVersion((v) => v + 1);
    await props.onDone(`Removed key "${keyName}"`);
  }

  return (
    <div className="form">
      <h4 className="section-h">Existing keys ({props.project.apiKeys.length})</h4>
      {props.project.apiKeys.length === 0 ? (
        <div className="empty-inline">No keys yet. Add one below.</div>
      ) : (
        <div className="key-list" key={keysVersion}>
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
              </div>
              <button
                type="button"
                className="ghost destructive small"
                onClick={() => remove(k.id, k.name)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <h4 className="section-h">Add a new key</h4>
      <form onSubmit={add}>
        <Field label="Key name" hint="A label so you can tell keys apart">
          <input
            type="text"
            placeholder="e.g. Production"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Key value" hint="The actual secret token from the API provider">
          <input
            type="password"
            placeholder="paste your secret"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field label="Header name">
            <input type="text" value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
          </Field>
          <Field label="Prefix" hint="e.g. 'Bearer ' (with trailing space)">
            <input
              type="text"
              value={headerPrefix}
              onChange={(e) => setHeaderPrefix(e.target.value)}
            />
          </Field>
        </div>

        {err && <div className="inline-error">{err}</div>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => props.onDone()}>
            Done
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Adding…" : "Add key"}
          </button>
        </div>
      </form>
    </div>
  );
}

// =============================================================
// Settings (project + Slack webhook + Slack bot token)
// =============================================================
export function SettingsForm(props: BaseProps & { project: Project }) {
  const [name, setName] = useState(props.project.name);
  const [description, setDescription] = useState(props.project.description);
  const [slackWebhook, setSlackWebhook] = useState(props.project.slackWebhookUrl);
  const [slackBotToken, setSlackBotToken] = useState(props.project.slackBotToken);
  const [slackChannel, setSlackChannel] = useState(props.project.slackChannel);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(props.project.name);
    setDescription(props.project.description);
    setSlackWebhook(props.project.slackWebhookUrl);
    setSlackBotToken(props.project.slackBotToken);
    setSlackChannel(props.project.slackChannel);
  }, [props.project.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await updateProject(props.project.id, {
        name: name.trim(),
        description: description.trim(),
        slackWebhookUrl: slackWebhook.trim(),
        slackBotToken: slackBotToken.trim(),
        slackChannel: slackChannel.trim(),
      });
      await props.onDone("Settings saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <h4 className="section-h">Project</h4>
      <Field label="Project name" required>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <h4 className="section-h">Slack — failure alerts (webhook)</h4>
      <Field
        label="Slack webhook URL"
        hint="Used for instant single-URL failure alerts. Leave empty to disable."
      >
        <input
          type="text"
          placeholder="https://hooks.slack.com/services/..."
          value={slackWebhook}
          onChange={(e) => setSlackWebhook(e.target.value)}
        />
      </Field>

      <h4 className="section-h">Slack — audit reports (bot token)</h4>
      <Field
        label="Slack bot token (xoxb-...)"
        hint="Used by Run Audit to post rich Block Kit summaries + upload the HTML report. Optional."
      >
        <input
          type="password"
          placeholder="xoxb-..."
          value={slackBotToken}
          onChange={(e) => setSlackBotToken(e.target.value)}
        />
      </Field>
      <Field label="Slack channel" hint="Where the audit message + file go (e.g. #monitoring)">
        <input
          type="text"
          placeholder="#monitoring"
          value={slackChannel}
          onChange={(e) => setSlackChannel(e.target.value)}
        />
      </Field>

      {err && <div className="inline-error">{err}</div>}

      <div className="modal-actions">
        <button type="button" className="ghost" onClick={() => props.onDone()}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
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
