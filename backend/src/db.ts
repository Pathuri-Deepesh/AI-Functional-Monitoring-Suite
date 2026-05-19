import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync, readFileSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const DB_FILE = "./data/db.sqlite";
const LEGACY_JSON = "./data/db.json";

let dbSingleton: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (dbSingleton) return dbSingleton;
  mkdirSync(dirname(DB_FILE), { recursive: true });
  dbSingleton = new DatabaseSync(DB_FILE);
  dbSingleton.exec("PRAGMA journal_mode = WAL;");
  dbSingleton.exec("PRAGMA foreign_keys = ON;");
  initSchema(dbSingleton);
  migrateFromJsonIfNeeded(dbSingleton);
  return dbSingleton;
}

/**
 * Run a function inside a SQLite transaction.
 * node:sqlite has no built-in transaction wrapper, so we manage BEGIN/COMMIT/ROLLBACK manually.
 */
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

function ensureColumn(
  d: DatabaseSync,
  table: string,
  column: string,
  ddl: string
): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function initSchema(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      slack_webhook_url TEXT NOT NULL DEFAULT '',
      slack_bot_token   TEXT NOT NULL DEFAULT '',
      slack_channel     TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL,
      name          TEXT NOT NULL,
      value         TEXT NOT NULL,
      header_name   TEXT NOT NULL DEFAULT 'Authorization',
      header_prefix TEXT NOT NULL DEFAULT 'Bearer ',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS urls (
      id               TEXT PRIMARY KEY,
      project_id       TEXT NOT NULL,
      url              TEXT NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      api_key_id       TEXT,
      interval_minutes INTEGER NOT NULL DEFAULT 5,
      method           TEXT NOT NULL DEFAULT 'GET',
      body_type        TEXT NOT NULL DEFAULT 'none',
      body             TEXT NOT NULL DEFAULT '',
      assertions_json  TEXT NOT NULL DEFAULT '[]',

      status_code      INTEGER,
      status_group     TEXT,
      error_reason     TEXT,
      timings_json     TEXT,
      last_checked     TEXT,

      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS checks (
      id                     TEXT PRIMARY KEY,
      url_id                 TEXT NOT NULL,
      status_code            INTEGER,
      status_group           TEXT,
      error_reason           TEXT,
      dns_ms                 INTEGER,
      tcp_ms                 INTEGER,
      tls_ms                 INTEGER,
      ttfb_ms                INTEGER,
      download_ms            INTEGER,
      total_ms               INTEGER,
      assertion_results_json TEXT NOT NULL DEFAULT '[]',
      ok                     INTEGER NOT NULL,
      checked_at             INTEGER NOT NULL,
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_checks_url_time ON checks(url_id, checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_checks_time ON checks(checked_at);

    -- ===== FLOWS =====
    CREATE TABLE IF NOT EXISTS flows (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      interval_minutes  INTEGER NOT NULL DEFAULT 5,
      stop_on_failure   INTEGER NOT NULL DEFAULT 1,
      enabled           INTEGER NOT NULL DEFAULT 1,
      last_run_at       INTEGER,
      created_at        TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS flow_steps (
      id                  TEXT PRIMARY KEY,
      flow_id             TEXT NOT NULL,
      position            INTEGER NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      url                 TEXT NOT NULL,
      method              TEXT NOT NULL DEFAULT 'GET',
      body_type           TEXT NOT NULL DEFAULT 'none',
      body                TEXT NOT NULL DEFAULT '',
      body_content_type   TEXT NOT NULL DEFAULT '',
      api_key_id          TEXT,
      assertions_json     TEXT NOT NULL DEFAULT '[]',
      custom_headers_json TEXT NOT NULL DEFAULT '[]',
      query_params_json   TEXT NOT NULL DEFAULT '[]',
      extractions_json    TEXT NOT NULL DEFAULT '[]',
      wait_before_ms      INTEGER NOT NULL DEFAULT 0,
      max_retries         INTEGER NOT NULL DEFAULT 0,
      retry_backoff_ms    INTEGER NOT NULL DEFAULT 1000,
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS flow_runs (
      id                TEXT PRIMARY KEY,
      flow_id           TEXT NOT NULL,
      started_at        INTEGER NOT NULL,
      ended_at          INTEGER,
      ok                INTEGER NOT NULL DEFAULT 0,
      failed_at_step_id TEXT,
      variables_json    TEXT NOT NULL DEFAULT '{}',
      total_ms          INTEGER,
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS step_results (
      id                     TEXT PRIMARY KEY,
      flow_run_id            TEXT NOT NULL,
      step_id                TEXT NOT NULL,
      position               INTEGER NOT NULL,
      status_code            INTEGER,
      status_group           TEXT,
      error_reason           TEXT,
      dns_ms                 INTEGER,
      tcp_ms                 INTEGER,
      tls_ms                 INTEGER,
      ttfb_ms                INTEGER,
      download_ms            INTEGER,
      total_ms               INTEGER,
      assertion_results_json TEXT NOT NULL DEFAULT '[]',
      extracted_values_json  TEXT NOT NULL DEFAULT '[]',
      attempts               INTEGER NOT NULL DEFAULT 1,
      skipped                INTEGER NOT NULL DEFAULT 0,
      skip_reason            TEXT,
      ok                     INTEGER NOT NULL,
      checked_at             INTEGER NOT NULL,
      FOREIGN KEY (flow_run_id) REFERENCES flow_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS variable_cache (
      flow_id        TEXT NOT NULL,
      variable_name  TEXT NOT NULL,
      value          TEXT NOT NULL,
      captured_at    INTEGER NOT NULL,
      expires_at     INTEGER NOT NULL,
      PRIMARY KEY (flow_id, variable_name),
      FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_flow_steps_flow ON flow_steps(flow_id, position);
    CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_time ON flow_runs(flow_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_step_results_run ON step_results(flow_run_id, position);
    CREATE INDEX IF NOT EXISTS idx_variable_cache_expiry ON variable_cache(expires_at);

    -- ===== PREREQUISITES (project-level setup chain) =====
    CREATE TABLE IF NOT EXISTS prereq_steps (
      id                  TEXT PRIMARY KEY,
      project_id          TEXT NOT NULL,
      position            INTEGER NOT NULL,
      description         TEXT NOT NULL DEFAULT '',
      url                 TEXT NOT NULL,
      method              TEXT NOT NULL DEFAULT 'GET',
      body_type           TEXT NOT NULL DEFAULT 'none',
      body                TEXT NOT NULL DEFAULT '',
      body_content_type   TEXT NOT NULL DEFAULT '',
      api_key_id          TEXT,
      assertions_json     TEXT NOT NULL DEFAULT '[]',
      custom_headers_json TEXT NOT NULL DEFAULT '[]',
      query_params_json   TEXT NOT NULL DEFAULT '[]',
      extractions_json    TEXT NOT NULL DEFAULT '[]',
      wait_before_ms      INTEGER NOT NULL DEFAULT 0,
      max_retries         INTEGER NOT NULL DEFAULT 0,
      retry_backoff_ms    INTEGER NOT NULL DEFAULT 1000,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS prereq_runs (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      started_at        INTEGER NOT NULL,
      ended_at          INTEGER,
      ok                INTEGER NOT NULL DEFAULT 0,
      failed_at_step_id TEXT,
      variables_json    TEXT NOT NULL DEFAULT '{}',
      total_ms          INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS prereq_step_results (
      id                     TEXT PRIMARY KEY,
      prereq_run_id          TEXT NOT NULL,
      step_id                TEXT NOT NULL,
      position               INTEGER NOT NULL,
      status_code            INTEGER,
      status_group           TEXT,
      error_reason           TEXT,
      dns_ms                 INTEGER,
      tcp_ms                 INTEGER,
      tls_ms                 INTEGER,
      ttfb_ms                INTEGER,
      download_ms            INTEGER,
      total_ms               INTEGER,
      assertion_results_json TEXT NOT NULL DEFAULT '[]',
      extracted_values_json  TEXT NOT NULL DEFAULT '[]',
      attempts               INTEGER NOT NULL DEFAULT 1,
      skipped                INTEGER NOT NULL DEFAULT 0,
      skip_reason            TEXT,
      ok                     INTEGER NOT NULL,
      checked_at             INTEGER NOT NULL,
      FOREIGN KEY (prereq_run_id) REFERENCES prereq_runs(id) ON DELETE CASCADE
    );

    -- Project-wide variable cache (populated by prereq runs; consumed by URLs + flows)
    CREATE TABLE IF NOT EXISTS project_variable_cache (
      project_id     TEXT NOT NULL,
      variable_name  TEXT NOT NULL,
      value          TEXT NOT NULL,
      captured_at    INTEGER NOT NULL,
      expires_at     INTEGER NOT NULL,
      PRIMARY KEY (project_id, variable_name),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_prereq_steps_project ON prereq_steps(project_id, position);
    CREATE INDEX IF NOT EXISTS idx_prereq_runs_project_time ON prereq_runs(project_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prereq_step_results_run ON prereq_step_results(prereq_run_id, position);
    CREATE INDEX IF NOT EXISTS idx_project_variable_cache_expiry ON project_variable_cache(expires_at);
  `);

  // Idempotent column additions for existing databases
  ensureColumn(d, "urls", "custom_headers_json", "custom_headers_json TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(d, "urls", "query_params_json", "query_params_json TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(d, "urls", "body_content_type", "body_content_type TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, "projects", "prereq_interval_minutes", "prereq_interval_minutes INTEGER NOT NULL DEFAULT 30");
  ensureColumn(d, "projects", "prereq_enabled", "prereq_enabled INTEGER NOT NULL DEFAULT 1");
  ensureColumn(d, "projects", "prereq_last_run_at", "prereq_last_run_at INTEGER");
}

function migrateFromJsonIfNeeded(d: DatabaseSync): void {
  const projectCount = d.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number };
  if (projectCount.c > 0) return;
  if (!existsSync(LEGACY_JSON)) return;

  let parsed: { projects: any[]; urls: any[] };
  try {
    parsed = JSON.parse(readFileSync(LEGACY_JSON, "utf8"));
  } catch {
    console.warn("[db] could not parse legacy db.json — skipping migration");
    return;
  }
  if (!parsed?.projects?.length && !parsed?.urls?.length) return;

  const insertProject = d.prepare(
    `INSERT INTO projects (id, name, description, slack_webhook_url, slack_bot_token, slack_channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertKey = d.prepare(
    `INSERT INTO api_keys (id, project_id, name, value, header_name, header_prefix)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertUrl = d.prepare(
    `INSERT INTO urls (id, project_id, url, description, api_key_id, interval_minutes,
                       method, body_type, body, assertions_json,
                       status_code, status_group, error_reason, timings_json, last_checked)
     VALUES (?, ?, ?, ?, ?, ?, 'GET', 'none', '', '[]', ?, ?, ?, ?, ?)`
  );

  d.exec("BEGIN");
  try {
    for (const p of parsed.projects ?? []) {
      insertProject.run(
        p.id ?? randomUUID(),
        p.name ?? "Untitled",
        p.description ?? "",
        p.slackWebhookUrl ?? "",
        "",
        "",
        p.createdAt ?? new Date().toISOString()
      );
      for (const k of p.apiKeys ?? []) {
        insertKey.run(
          k.id ?? randomUUID(),
          p.id,
          k.name ?? "Untitled key",
          k.value ?? "",
          k.headerName ?? "Authorization",
          k.headerPrefix ?? "Bearer "
        );
      }
    }
    for (const u of parsed.urls ?? []) {
      insertUrl.run(
        u.id ?? randomUUID(),
        u.projectId,
        u.url,
        u.description ?? "",
        u.apiKeyId ?? null,
        Number(u.intervalMinutes ?? 5),
        u.statusCode ?? null,
        u.statusGroup ?? null,
        u.errorReason ?? null,
        u.timings ? JSON.stringify(u.timings) : null,
        u.lastChecked ?? null
      );
    }
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    console.error("[db] migration failed:", err);
    return;
  }

  try {
    renameSync(LEGACY_JSON, `${LEGACY_JSON}.migrated.bak`);
  } catch {}
  console.log(
    `[db] migrated ${parsed.projects?.length ?? 0} project(s), ${parsed.urls?.length ?? 0} URL(s) from legacy db.json`
  );
}

// Keep 1 year of history so the dashboard can show 24h / 7d / 30d / 90d / 1y views.
const RETENTION_DAYS = 365;

export function pruneOldChecks(): void {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const result = db().prepare("DELETE FROM checks WHERE checked_at < ?").run(cutoff);
  if (result.changes > 0) {
    console.log(`[db] pruned ${result.changes} old check(s) (older than ${RETENTION_DAYS} days)`);
  }
  // Prune expired variable cache entries (best-effort cleanup)
  const cacheResult = db().prepare("DELETE FROM variable_cache WHERE expires_at < ?").run(Date.now());
  if (cacheResult.changes > 0) {
    console.log(`[db] pruned ${cacheResult.changes} expired cached variable(s)`);
  }
  // Prune old flow runs (keep last 365 days too)
  const flowRunResult = db().prepare("DELETE FROM flow_runs WHERE started_at < ?").run(cutoff);
  if (flowRunResult.changes > 0) {
    console.log(`[db] pruned ${flowRunResult.changes} old flow run(s)`);
  }
  // Prune old prereq runs
  const prereqRunResult = db().prepare("DELETE FROM prereq_runs WHERE started_at < ?").run(cutoff);
  if (prereqRunResult.changes > 0) {
    console.log(`[db] pruned ${prereqRunResult.changes} old prereq run(s)`);
  }
  // Prune expired project-variable cache
  const pvc = db().prepare("DELETE FROM project_variable_cache WHERE expires_at < ?").run(Date.now());
  if (pvc.changes > 0) {
    console.log(`[db] pruned ${pvc.changes} expired project variable(s)`);
  }
}

export type { StatementSync };
