# Secrets Manager Implementation Guide — Step by Step

**Feature:** Store project API keys as a JSON blob in AWS Secrets Manager. When user adds a key in Settings, app writes to Secrets Manager AND updates local cache (Option D — write-through pattern).

**Chosen behavior on AWS outage:** D1 — show error, don't save. Simple and honest.

**Prepared:** 2026-07-08
**Author:** Deepesh P
**Estimated time:** ~7 hours end to end (setup + code + test)

---

## Table of Contents

1. [Prerequisites — what you need before starting](#1-prerequisites)
2. [Phase A — AWS Console setup (~45 min)](#phase-a--aws-console-setup)
3. [Phase B — Local project setup (~15 min)](#phase-b--local-project-setup)
4. [Phase C — Build the secrets module (~1 hour)](#phase-c--build-the-secrets-module)
5. [Phase D — Wire boot-time load (~15 min)](#phase-d--wire-boot-time-load)
6. [Phase E — Hook UI Add/Edit/Delete into Secrets Manager (~2 hours)](#phase-e--hook-ui-actions-into-secrets-manager)
7. [Phase F — Swap read paths to use the cache (~1 hour)](#phase-f--swap-read-paths-to-use-the-cache)
8. [Phase G — Local end-to-end test (~1 hour)](#phase-g--local-end-to-end-test)
9. [Phase H — Docs + commit + push (~30 min)](#phase-h--docs--commit--push)
10. [Rollback plan](#10-rollback-plan)

---

## 1. Prerequisites

Before starting, gather:

- [ ] **AWS account access** — logged in as an admin or a user with permission to create IAM users + secrets
- [ ] **AWS region decided** — we'll use `us-east-1` throughout (change if your team dictates another)
- [ ] **Access key + secret key** for a local dev IAM user (used from your laptop for testing)
- [ ] **Node.js 20 LTS + npm** installed
- [ ] **Git access** to the repo
- [ ] **~15 GB free disk** for node_modules
- [ ] **Terminal open** in `C:\Users\dp1\Desktop\AI-Functional-Monitoring-Suite`

---

## Phase A — AWS Console setup

### A.1 — Log into AWS Console

1. Go to **https://console.aws.amazon.com/**
2. Sign in with your AWS account credentials
3. **Top-right corner:** confirm the region reads **"N. Virginia" (us-east-1)**. If not, click and switch.

### A.2 — Create the IAM user (`monitor-app-user`)

**Navigation:** Search "IAM" in the top search bar → click **IAM** → left sidebar → **Users** → **Create user** (orange button top-right).

**Screen 1 — Specify user details:**
- **User name:** `monitor-app-user`
- **Provide user access to the AWS Management Console:** leave **unchecked** (this is a machine identity, not a person)
- Click **Next**

**Screen 2 — Set permissions:**
- Select **Attach policies directly**
- Do NOT pick any managed policy yet — click **Next**

**Screen 3 — Review and create:**
- Click **Create user**

**Screen 4 — after creation:**
- You'll see the user in the list. Click on **`monitor-app-user`** to open it.
- Go to the **Permissions** tab → click **Add permissions** → **Create inline policy**

**Screen 5 — Create inline policy:**
- Click the **JSON** tab (not Visual)
- Paste this:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "SecretsManagerAccess",
        "Effect": "Allow",
        "Action": [
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:DescribeSecret"
        ],
        "Resource": "arn:aws:secretsmanager:us-east-1:*:secret:/monitor-suite/project-api-keys-*"
      }
    ]
  }
  ```
- Click **Next**
- **Policy name:** `monitor-app-secrets-access`
- Click **Create policy**

### A.3 — Generate access keys for the IAM user

Still on the user's page:

1. Click the **Security credentials** tab
2. Scroll to **Access keys** → click **Create access key**
3. **Use case:** select **Application running outside AWS** → **Next**
4. **Description tag:** `local-dev-laptop` → **Create access key**
5. **CRITICAL:** Copy both:
   - **Access key ID** (starts with `AKIA...`)
   - **Secret access key** (long random string)
6. Paste both into a scratch file on your laptop — you will need these in Phase B. **The secret key is only shown ONCE — if you close this page without copying it, you must generate a new one.**
7. Click **Done**

### A.4 — Create the Secrets Manager secret

**Navigation:** Top search bar → search **"Secrets Manager"** → click **Secrets Manager** service.

**Screen 1 — Landing page:**
- Click **Store a new secret** (orange button top-right)

**Screen 2 — Choose secret type:**
- **Secret type:** select **Other type of secret**
- **Key/value pairs section:** click the **Plaintext** tab
- Paste this starter JSON:
  ```json
  {
    "_meta": {
      "updated": "2026-07-08",
      "notes": "project ID → outbound API key"
    }
  }
  ```
  *(We start with just `_meta`. Real keys get added later via the app UI.)*
- **Encryption key:** leave as **aws/secretsmanager** (default, free)
- Click **Next**

**Screen 3 — Configure secret:**
- **Secret name:** `/monitor-suite/project-api-keys`
- **Description:** `Project ID to API key mapping for AI-Functional-Monitoring-Suite`
- Leave tags empty
- Leave "Resource permissions" empty (we handle access via IAM user)
- Click **Next**

**Screen 4 — Configure rotation:**
- Leave **Automatic rotation OFF** (we don't need it)
- Click **Next**

**Screen 5 — Review:**
- Scroll to the bottom → click **Store**

**After creation — CAPTURE THE ARN:**
1. You should land on the secret's detail page.
2. Near the top under **Secret ARN**, click the copy icon.
3. Paste it into your scratch file. Looks like:
   ```
   arn:aws:secretsmanager:us-east-1:123456789012:secret:/monitor-suite/project-api-keys-a1B2c3
   ```
4. You will need this ARN in Phase B.

### A.5 — Verify with a manual read

Still on the secret's page:

1. Click **Retrieve secret value** (button in the middle of the page)
2. Confirm you see the JSON you pasted
3. This verifies the secret exists and is readable — you'll do the same from code shortly

---

## Phase B — Local project setup

### B.1 — Update `backend/.env`

Open [backend/.env](../backend/.env) in your editor. Add these three new lines at the bottom:

```
# AWS Secrets Manager (Phase 1.28)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...paste-from-A.3
AWS_SECRET_ACCESS_KEY=...paste-from-A.3
PROJECT_KEYS_SECRET_ARN=arn:aws:secretsmanager:us-east-1:...:secret:/monitor-suite/project-api-keys-XXXXXX
```

**Note:** if `AWS_REGION` is already set from the SES integration (Phase 1.27.8), don't add it twice.

### B.2 — Update `backend/.env.example`

Open [backend/.env.example](../backend/.env.example). Add the same four lines but with placeholder values so future teammates know they exist:

```
# AWS Secrets Manager — project API key vault (Phase 1.28)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-iam-user-access-key
AWS_SECRET_ACCESS_KEY=your-iam-user-secret-key
PROJECT_KEYS_SECRET_ARN=arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/monitor-suite/project-api-keys-XXXXXX
```

### B.3 — Install the AWS SDK package

Open a **terminal in the repo root**:

```bash
cd /c/Users/dp1/Desktop/AI-Functional-Monitoring-Suite/backend
npm install @aws-sdk/client-secrets-manager
```

Expected output: `added 1 package` (or more if it pulls in shared AWS deps). Should take ~20 seconds.

Verify by opening [backend/package.json](../backend/package.json) — you should see `"@aws-sdk/client-secrets-manager": "^3.x.x"` in `dependencies`.

---

## Phase C — Build the secrets module

### C.1 — Create `backend/src/secrets.ts`

Full file contents:

```ts
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: process.env.AWS_REGION });

const SECRET_ARN = process.env.PROJECT_KEYS_SECRET_ARN;

interface SecretShape {
  _meta?: { updated?: string; notes?: string };
  [projectId: string]: string | SecretShape["_meta"];
}

let cache: Record<string, string> = {};
let currentVersionId: string | null = null;
let loaded = false;

function parseSecret(json: string): { keys: Record<string, string>; meta: any } {
  const parsed = JSON.parse(json) as SecretShape;
  const { _meta, ...keys } = parsed;
  const stringKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (typeof v === "string") stringKeys[k] = v;
  }
  return { keys: stringKeys, meta: _meta ?? {} };
}

export async function loadProjectApiKeys(): Promise<void> {
  if (!SECRET_ARN) throw new Error("PROJECT_KEYS_SECRET_ARN not set");
  const res = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  if (!res.SecretString) throw new Error("Secret has no SecretString");
  const { keys } = parseSecret(res.SecretString);
  cache = keys;
  currentVersionId = res.VersionId ?? null;
  loaded = true;
  console.log(`[secrets] loaded ${Object.keys(cache).length} project API keys`);
}

export async function reloadProjectApiKeys(): Promise<void> {
  loaded = false;
  await loadProjectApiKeys();
}

export function getApiKeyForProject(projectId: string): string | null {
  if (!loaded) throw new Error("Call loadProjectApiKeys() at boot first");
  return cache[projectId] ?? null;
}

export function hasApiKeyForProject(projectId: string): boolean {
  return loaded && projectId in cache;
}

export function listProjectsWithKeys(): string[] {
  return Object.keys(cache);
}

/**
 * Write-through add/update. Fetches latest, mutates, writes back.
 * Retries once on version-conflict (another writer beat us).
 */
export async function upsertProjectApiKey(projectId: string, apiKey: string): Promise<void> {
  if (!SECRET_ARN) throw new Error("PROJECT_KEYS_SECRET_ARN not set");
  await mutateSecret((keys, meta) => {
    keys[projectId] = apiKey;
    meta.updated = new Date().toISOString().slice(0, 10);
    return { keys, meta };
  });
}

export async function deleteProjectApiKey(projectId: string): Promise<void> {
  if (!SECRET_ARN) throw new Error("PROJECT_KEYS_SECRET_ARN not set");
  await mutateSecret((keys, meta) => {
    delete keys[projectId];
    meta.updated = new Date().toISOString().slice(0, 10);
    return { keys, meta };
  });
}

async function mutateSecret(
  mutator: (keys: Record<string, string>, meta: any) => { keys: Record<string, string>; meta: any },
  attempt = 0
): Promise<void> {
  const res = await client.send(new GetSecretValueCommand({ SecretId: SECRET_ARN! }));
  if (!res.SecretString) throw new Error("Secret has no SecretString");

  const parsed = parseSecret(res.SecretString);
  const next = mutator({ ...parsed.keys }, { ...parsed.meta });
  const newJson = JSON.stringify({ _meta: next.meta, ...next.keys }, null, 2);

  if (Buffer.byteLength(newJson, "utf8") > 60_000) {
    throw new Error("Secret JSON approaching 64 KB limit — split into a second secret");
  }

  try {
    await client.send(
      new PutSecretValueCommand({
        SecretId: SECRET_ARN!,
        SecretString: newJson,
      })
    );
  } catch (err: any) {
    if (attempt === 0 && err?.name === "ResourceExistsException") {
      return mutateSecret(mutator, 1);
    }
    throw err;
  }

  cache = next.keys;
  await refreshVersionId();
}

async function refreshVersionId(): Promise<void> {
  try {
    const desc = await client.send(new DescribeSecretCommand({ SecretId: SECRET_ARN! }));
    const stages = desc.VersionIdsToStages ?? {};
    for (const [vid, labels] of Object.entries(stages)) {
      if (labels.includes("AWSCURRENT")) {
        currentVersionId = vid;
        return;
      }
    }
  } catch {
    // best-effort; not fatal
  }
}
```

**What this file does (in plain terms):**
- `loadProjectApiKeys()` — call once at app boot; fetches the JSON, caches in RAM.
- `getApiKeyForProject(projectId)` — instant RAM lookup, use in every outbound call site.
- `upsertProjectApiKey(projectId, apiKey)` — write-through: read latest, merge, save back, update cache.
- `deleteProjectApiKey(projectId)` — same pattern, removes entry.
- `reloadProjectApiKeys()` — manual re-fetch (useful for an admin endpoint later).

### C.2 — Compile-check

```bash
cd /c/Users/dp1/Desktop/AI-Functional-Monitoring-Suite/backend
npx tsc --noEmit
```

Expected: zero output = clean. If errors appear, fix them before continuing.

---

## Phase D — Wire boot-time load

### D.1 — Edit `backend/src/app.ts`

1. Open [backend/src/app.ts](../backend/src/app.ts)
2. Near the top imports, add:
   ```ts
   import { loadProjectApiKeys } from "./secrets.js";
   ```
3. Find where the DB init happens (roughly `initDb()` or `openDb()`).
4. After DB init succeeds but BEFORE the monitor loop starts, add:
   ```ts
   await loadProjectApiKeys();
   ```
5. Wrap in try/catch that logs and re-throws so systemd restarts cleanly if AWS is unreachable:
   ```ts
   try {
     await loadProjectApiKeys();
   } catch (err) {
     console.error("[boot] Secrets Manager unreachable — cannot start:", err);
     process.exit(1);
   }
   ```

### D.2 — Verify boot works

```bash
cd /c/Users/dp1/Desktop/AI-Functional-Monitoring-Suite
npm run build
npm start
```

Watch the console. You should see:
```
[secrets] loaded 0 project API keys
```
(Zero because the JSON has only `_meta` at this point.)

If you see a crash instead — check `.env` for typos, especially the ARN.

---

## Phase E — Hook UI actions into Secrets Manager

Right now, when the user adds a key in Settings, the app writes to SQLite. We need it to ALSO write to Secrets Manager.

### E.1 — Find the current "add API key" endpoint

```bash
cd /c/Users/dp1/Desktop/AI-Functional-Monitoring-Suite/backend/src
grep -n "apiKeys" app.ts | head -20
```

Expect to see routes like `POST /api/projects/:id/api-keys` and `DELETE /api/projects/:id/api-keys/:keyId`.

### E.2 — Edit the add-key endpoint

1. Open [backend/src/app.ts](../backend/src/app.ts)
2. Find the handler for `POST /api/projects/:id/api-keys` (or similar)
3. Import at top: `import { upsertProjectApiKey } from "./secrets.js";`
4. In the handler, AFTER the SQLite write succeeds but BEFORE responding to the client:
   ```ts
   try {
     await upsertProjectApiKey(project.id, keyValue);
   } catch (err) {
     console.error("[api-keys] Secrets Manager write failed:", err);
     // Roll back the SQLite write so state stays consistent
     await store.deleteApiKey(project.id, newKey.id);
     return sendError(res, 503, "Could not save to secrets vault. Please try again.");
   }
   ```

### E.3 — Edit the delete-key endpoint

1. Import at top: `import { deleteProjectApiKey } from "./secrets.js";`
2. In the DELETE handler, after SQLite delete succeeds:
   ```ts
   try {
     await deleteProjectApiKey(project.id);
   } catch (err) {
     console.error("[api-keys] Secrets Manager delete failed:", err);
     // Note: SQLite is already deleted; log for manual reconciliation
   }
   ```

### E.4 — Edit the edit-key endpoint (if one exists)

Same pattern as E.2 — call `upsertProjectApiKey` after SQLite update.

### E.5 — Rebuild + verify

```bash
cd /c/Users/dp1/Desktop/AI-Functional-Monitoring-Suite
npm run build
npm start
```

Open http://127.0.0.1:4000 → Settings → API Keys → add a test key.

Then open the AWS console → Secrets Manager → your secret → Retrieve secret value → confirm the new entry is there:
```json
{
  "_meta": { "updated": "2026-07-08", ... },
  "proj_abc123": "test-key-value"
}
```

---

## Phase F — Swap read paths to use the cache

Now that keys flow into Secrets Manager on write, downstream code should read from the cache instead of SQLite.

### F.1 — Find the read call sites

```bash
cd /c/Users/dp1/Desktop/AI-Functional-Monitoring-Suite/backend/src
grep -rn "getProjectApiKeysScope\|apiKeys\[" .
```

Expect matches in `monitor.ts`, `flowRunner.ts`, `prereqRunner.ts`.

### F.2 — Update the runners

Wherever the code reads `project.apiKeys[...]` or calls `getProjectApiKeysScope(...)`, add a fallback path that uses Secrets Manager cache:

```ts
import { getApiKeyForProject } from "./secrets.js";

// existing code that pulls from SQLite scope:
const legacyKey = scope["myKey"];

// new: check Secrets Manager first
const smKey = getApiKeyForProject(project.id);
const finalKey = smKey ?? legacyKey;
```

**Decision:** Secrets Manager wins on conflict (it's the newer source of truth).

### F.3 — Verify

Restart the app. Trigger a URL check on a project that has an API key. Watch the app log — the outbound request should include the correct `Authorization` header.

---

## Phase G — Local end-to-end test

Test checklist:

- [ ] **Boot test** — `npm start` → console shows `[secrets] loaded N project API keys` (no crash)
- [ ] **Add key test** — Settings → API Keys → add key → verify entry appears in AWS console
- [ ] **Restart persistence** — restart app → console shows correct key count → key still in AWS
- [ ] **Delete test** — remove key in UI → verify entry disappears from AWS console
- [ ] **Monitor uses the key** — create a URL check on a project with a key → trigger check → verify `Authorization` header sent (check server access logs on the target URL)
- [ ] **AWS-down test** — temporarily break `AWS_ACCESS_KEY_ID` in `.env` → restart → app should exit with clear error message
- [ ] **Concurrent-writer test (skip if solo)** — with 2 browser tabs, add 2 different keys within 1 second → both should appear in AWS

---

## Phase H — Docs + commit + push

### H.1 — Bump version

Edit [package.json](../package.json):
```json
"version": "1.28.0"
```

### H.2 — Update PROGRESS.md

Add a new dated section:
```markdown
### 2026-07-08 — Phase 1.28 Secrets Manager write-through vault (N items)
- **Why:** ...
- **New module:** backend/src/secrets.ts — load/get/upsert/delete
- **UI hook:** POST/DELETE /api/projects/:id/api-keys now write-through to Secrets Manager
- **Runner reads:** Secrets Manager cache overrides legacy SQLite vault on conflict
- ...
```

### H.3 — Update STATUS.md

Bump the "Current phase" block to Phase 1.28.

### H.4 — Update project-tracker.csv

Append 4-6 rows tagged `28.1`, `28.2`, ... under `Phase 1.28 - Secrets Manager vault`.

### H.5 — Regenerate xlsx

```bash
cd /c/Users/dp1/Desktop/AI-Functional-Monitoring-Suite
py .claude_internal/csv_to_xlsx.py
```

### H.6 — Commit + push

```bash
git add -A
git commit -m "Phase 1.28 — Secrets Manager write-through vault for project API keys"
git push origin main
```

---

## 10. Rollback plan

If something goes wrong in production:

**Option 1 — Disable the Secrets Manager path via env var:**
- Set `PROJECT_KEYS_SECRET_ARN=` (empty) in `.env`
- Restart app
- App skips the Secrets Manager fetch on boot
- Falls back to SQLite vault (still works)

**Option 2 — Restore from an earlier secret version:**
- AWS Console → Secrets Manager → your secret → **Versions** tab
- Find the last known-good version → click **Restore**
- Restart app

**Option 3 — Revert the commit:**
- `git revert <commit-sha>` → push → redeploy
- The old SQLite-only vault is restored

---

## Summary

| Phase | Time | What you do |
|---|---|---|
| A | 45 min | AWS Console: IAM user + secret |
| B | 15 min | .env + install SDK |
| C | 1 hour | Write secrets.ts |
| D | 15 min | Wire boot-time load |
| E | 2 hours | Hook add/delete/edit endpoints |
| F | 1 hour | Runners read from cache |
| G | 1 hour | Local end-to-end test |
| H | 30 min | Docs + commit + push |
| **Total** | **~7 hours** | Complete implementation |

---

**End of guide.**
