# AWS Deployment Plan — AI-Powered Functional Monitoring Suite

**Prepared by:** Deepesh P
**For:** [Manager Name] · [Infra Team]
**Date:** 2026-07-06
**Repository:** https://github.com/Pathuri-Deepesh/AI-Functional-Monitoring-Suite
**Deployment target:** AWS
**Estimated monthly cost:** ~$18
**Estimated setup time:** ~4 hours (Phase 1) + ~1.5 days code work (S3 + Secrets Manager wiring)

---

## 1. Executive summary (30-second version)

The Monitoring Suite is a **single Node.js application** with **local SQLite storage** and a **continuous background monitor loop**. That shape defines the deployment: it needs a computer that's always on, a real disk to write to, an object store for binary files, a vault for one shared API key, and a way to send emails.

Deployment is split into **two phases**:

- **Phase 1 (me):** deploy the app to a single AWS EC2 instance with a persistent EBS disk, an S3 bucket for uploads and reports, one Secrets Manager secret for the shared API key, and SES for outbound emails. App becomes reachable at `http://<ec2-ip>:4000`.
- **Phase 2 (infra team):** point a corporate subdomain at my EC2 and terminate HTTPS on their side. Zero coordination beyond me handing them the IP and a short README.

Result: **7 AWS building blocks, ~$18/month, ~4 hours of setup, small additive code changes for S3 and Secrets Manager.**

---

## 2. Why this architecture — the reasoning trail

I evaluated three deployment shapes and rejected two.

### Rejected: AWS Lambda (serverless functions)

- The app runs a **30-second cron loop** — a continuously-running process, exactly what Lambda is not designed for.
- Lambda's 15-minute max execution kills long flow runs (some can take 5–10 minutes with retries and backoffs).
- SQLite requires a real filesystem; Lambda would force a rewrite to DynamoDB (2–3 weeks of work).
- Cost at our steady traffic (~2 checks/minute, 24/7) would be **higher** than EC2, not lower.

### Rejected: AWS Fargate (serverless containers)

- SQLite needs `fsync()` semantics; Fargate's shared filesystem option (EFS) adds 10–50ms per write.
- Our app writes multiple rows per tick — the tick would slow from milliseconds to seconds.
- Adds container-registry + task-definition complexity with no benefit at single-instance scale.

### Chosen: EC2 + EBS + S3 + Secrets Manager

- Matches the app's shape exactly — a persistent process on a real filesystem for the database, object storage for files, a vault for the shared credential.
- Standard AWS building blocks the rest of the team already understands.
- ~$18/month, most of which is the compute itself.
- Clear scale-up path: add ALB in front → add a second EC2 → migrate SQLite to RDS. Each step is independently manageable later.

---

## 3. The 7 building blocks

| # | Service | Job | Cost/mo |
|---|---|---|---|
| 1 | **EC2 t3.small** | The Linux computer running the Node app 24/7 | $15 |
| 2 | **EBS 20 GB gp3** | The disk that holds Ubuntu + app code + SQLite database | $2 |
| 3 | **S3 Bucket** | Object storage for user uploads and generated audit reports | ~$0.50 |
| 4 | **Secrets Manager** | Vault holding the one shared API key | $0.40 |
| 5 | **SES** | Outbound email — failure alerts, audit reports | $0 (free tier from EC2) |
| 6 | **IAM User** | The app's AWS identity — scoped access to SES, S3, Secrets Manager | $0 |
| 7 | **systemd** | Keeps the Node process running; restarts on crash (built into Ubuntu) | $0 |
| | **Total** | | **~$18** |

---

## 4. Where every piece of data lives

The single most important design decision is **which storage each kind of data belongs in**. This matrix is the answer.

| Data | Lives in | Why here |
|---|---|---|
| SQLite database (`data/db.sqlite`) — users, projects, URLs, checks, alerts, flows, run history | **EBS** | Needs `fsync()`, file locks, random writes. Only EBS provides real filesystem semantics. |
| App code (compiled backend + frontend bundle) | **EBS** | Node loads it at process start from local filesystem. |
| Ubuntu OS + Node.js runtime + systemd | **EBS** | EC2 boots from EBS by definition. |
| systemd + app logs | **EBS** (`/var/log/`, `/app/logs/`) | Continuous append writes; log rotation needs a filesystem. |
| `.env` — AWS keys, S3 bucket name, region, secret ARN | **EBS** (`/app/backend/.env`) | Read once at boot; must be on local disk. |
| Uploaded binary files (user-attached step payloads) | **S3** (`uploads/<projectId>/<uploadId>`) | Large blobs, cheap storage, no DB semantics needed. |
| Generated audit reports (HTML) | **S3** (`reports/<projectId>/<reportId>.html`) | Write-once, read-occasionally; presigned URLs make sharing easy. |
| The one shared API key | **Secrets Manager** (`/monitor-suite/shared-api-key`) | Rotatable, audited, kept out of `.env` on the box. |
| Outbound emails (failure alerts, audit summaries) | Sent via **SES** (no storage) | SES is a send-only pipe; nothing is stored. |

### Why EBS AND S3 both exist

A common question: "if we have S3, why do we need EBS?"

Answer: **SQLite cannot run on S3.** S3 has no `fsync()`, no file locks, no random writes — every "write" is uploading a whole new copy of the object. Running a database on S3 would corrupt it on the first crash mid-write. EBS is a real disk; S3 is object storage. They solve different problems.

Separately, EC2 always needs an EBS boot volume — the OS itself has to live somewhere. So EBS is not optional; it's the machine's disk.

S3 gets used for the *files* (uploads, reports) that don't need database semantics — where object storage is cheaper and more durable than sizing up the EBS volume.

---

## 5. The 7 services in detail

### 5.1 EC2 t3.small — The computer

**What it is:** A virtual Linux machine in AWS. 2 vCPU, 2 GB RAM, Ubuntu 24.04 LTS.

**What it does:**
- Runs the Node.js process on port 4000 24/7.
- Serves the React SPA + `/api/*` endpoints from the same bundle (Phase 1.27.10 single-server pattern).
- Runs the 30-second monitor loop that polls URLs and executes scheduled flows.

**Why t3.small:** app + Node + SQLite comfortably fits in 2 GB RAM at our workload. Burstable CPU covers spiky flow-run periods.

**Cost:** $15.18/mo on-demand in us-east-1.

### 5.2 EBS 20 GB (gp3) — The hard drive

**What it is:** A virtual SSD attached to the EC2 as a block device, mounted as the root filesystem.

**What it holds:**
- Ubuntu OS (~5 GB)
- Node.js + npm + system packages (~1 GB)
- App code (backend `dist/` + bundled frontend, ~500 MB)
- **`data/db.sqlite`** — the entire database
- `logs/`, `.env`, systemd unit files

**Sizing:** 20 GB is comfortable. DB growth at current usage is ~30 MB/month; even in five years it wouldn't exceed 2 GB. Uploads and reports live in S3, not here, so the disk stays lean.

**Snapshots:** one manual EBS snapshot after initial deploy as a rollback point. No automated DLM lifecycle policy in Phase 1 (added later if needed).

**Cost:** ~$1.60/mo (20 GB × $0.08).

### 5.3 S3 Bucket — Object storage for files

**What it is:** AWS's object storage service. Files live in "buckets" and are addressed by a key (path-like string). Access is via HTTP API (`s3.putObject`, `s3.getObject`), not filesystem calls.

**What it holds:**
- `uploads/<projectId>/<uploadId>` — every binary file users attach to flow steps.
- `reports/<projectId>/<reportId>.html` — every generated audit report.

**Bucket configuration:**
- Name: `monitor-suite-storage-<random-suffix>` (bucket names are globally unique on AWS).
- Region: same as EC2 (us-east-1) — same-region S3 traffic is free.
- Block all public access: **enabled** (nothing is public; app-mediated access only).
- Versioning: **enabled** (protects against accidental overwrite/delete).
- Server-side encryption: **AES-256** (default, free).

**Why S3 instead of a bigger EBS volume:**
- Cost — S3 is $0.023/GB/mo vs EBS $0.08/GB/mo (roughly 4× cheaper per GB).
- Durability — S3 is 11 nines of durability (`99.999999999%`); the bucket survives even if the EC2 is destroyed.
- Isolation — files aren't coupled to the compute lifecycle. Rebuild the EC2 and the files are untouched.

**Code impact:** small additive change. Replace `fs.writeFileSync('./data/uploads/...')` with `s3.send(new PutObjectCommand(...))`. Reads similarly become `GetObjectCommand`. Roughly 4–6 code sites total (~1 day of work).

**Cost:** ~$0.50/mo at expected usage (a few GB of files, low request volume).

### 5.4 Secrets Manager — Vault for the one shared API key

**What it is:** AWS's secret-storage service. Holds sensitive strings (API keys, DB passwords, tokens) with automatic encryption at rest, audit logging via CloudTrail, and built-in rotation support.

**What it holds:**
- **One secret** named `/monitor-suite/shared-api-key` containing the shared credential the team wants centralized.

**How the app uses it:**
1. At process startup, the Node app calls `GetSecretValue` using the IAM user's credentials.
2. The returned string is cached in a module-level variable in RAM.
3. All subsequent app code reads from the cached variable — Secrets Manager is not called again during runtime.
4. On key rotation: rotate in the AWS console → restart the app (`sudo systemctl restart monitor-suite`) → new value is picked up. Zero code changes.

**Why Secrets Manager and not `.env`:**
- **Rotation-ready** — swap the value in the console any time; app restart picks it up.
- **Audit log** — CloudTrail records every read, useful for compliance/audit.
- **Not on the box** — if the EC2 is compromised, the attacker gets whatever's in `.env` (the AWS user credentials) but not the shared API key directly.
- **Team requirement** — infra team asked for it explicitly.

**Why only one secret (cost math):**
- Secrets Manager charges $0.40 per secret per month.
- Team confirmed only **one shared key** needs storing (used for all downstream operations).
- Per-project user-managed API keys stay in SQLite (unencrypted for now — Phase 1.28 later if scope changes).

**Code impact:** ~2 hours. New file `backend/src/secrets.ts` (~30 lines: `GetSecretValueCommand` + module-level cache + boot-time fetch).

**Cost:** $0.40/mo (one secret) + effectively $0 for reads (~10/month at $0.05 per 10,000).

### 5.5 SES (Simple Email Service) — Outbound email

**What it is:** AWS's transactional email service. Send-only — no inbox, no storage.

**What it does:**
- Sends URL failure alerts (Phase 1.27.2 general channel).
- Sends flow failure alerts.
- Sends latency-only alerts to the latency-channel recipients (Phase 1.27.2).
- Sends daily audit report emails with a link to the S3-hosted HTML report.

**Setup:**
- Verify a sender identity (either a single email like `monitor-alerts@company.com` or an entire domain).
- Move out of the SES sandbox (default region cap: 200 emails/day) — one-time request via the SES console, usually approved within 24 hours.
- Once approved: 62,000 emails/month **free** when sent from EC2.

**Why SES over Gmail SMTP:**
- Free tier from EC2 covers our volume forever.
- No rate limits at our scale.
- Native AWS integration — same IAM user, same region, same billing.
- No third-party dependency.

**Cost:** $0.

### 5.6 IAM User (`monitor-app-user`) — The app's AWS identity

**What it is:** A machine identity in AWS. Has an access key ID + secret access key (not a human login). The app uses these to authenticate to AWS services.

**What it can do (its permissions):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::monitor-suite-storage-*/*"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:us-east-1:*:secret:/monitor-suite/shared-api-key-*"
    }
  ]
}
```

Three tightly-scoped grants — nothing else. The user cannot list other buckets, cannot read other secrets, cannot touch EC2 or any other AWS resource.

**Why IAM user and not IAM role:**
- User is simpler to set up — generate access key, drop in `.env`, done.
- Role requires attaching to the EC2 instance profile and using the AWS SDK's default credential provider chain — more moving parts.
- I'm leaving in a few weeks; the AWS account is throwaway. If a key leaks, revoke and re-issue.
- Explicit user-level decision, not overlooked.

**Where the credentials live:** `backend/.env` on the EC2 (EBS). `.env` is `chmod 600` (owner-read only). Not in Git.

**Cost:** $0 — IAM users are free.

### 5.7 systemd — Process manager

**What it is:** Linux's init system. Comes built-in with Ubuntu — not an AWS service.

**What it does:**
- Starts the Node app when the EC2 boots.
- Restarts the app automatically if it crashes (`Restart=always`).
- Streams stdout/stderr to `journalctl` for querying.
- Manages the process lifecycle (`systemctl start/stop/restart/status`).

**Unit file:** `/etc/systemd/system/monitor-suite.service` — ~15 lines of config.

**Why systemd over PM2/Docker/Forever:**
- Zero extra install — already on the box.
- Zero extra config beyond the one unit file.
- Battle-tested, standard Linux tooling the infra team already knows.

**Cost:** $0.

---

## 6. How it all connects — the data-flow story

### On app startup

1. EC2 boots → Ubuntu loads from **EBS** → systemd starts.
2. systemd launches `node dist/index.js` from **EBS**.
3. Node reads `backend/.env` from **EBS** — pulls AWS access key, S3 bucket name, secret ARN, DB path.
4. Node uses the AWS credentials to call **Secrets Manager** — fetches the shared API key → caches in RAM.
5. Node opens **SQLite** at `/app/data/db.sqlite` on **EBS**.
6. Monitor loop starts. App listens on port 4000.

### When a user opens the app

1. Browser hits `http://<ec2-ip>:4000`.
2. Node app serves the React bundle from **EBS**.
3. React makes API calls to `/api/*` on the same origin.

### When a user uploads a binary file

1. Browser POSTs to `/api/uploads`.
2. Node streams the file to **S3** at `uploads/<projectId>/<uploadId>`.
3. Metadata (filename, upload ID, project ID) is written to **SQLite** on **EBS**.

### Every 30 seconds (monitor tick)

1. Node reads active URLs + assertions from **SQLite** on **EBS**.
2. For any check needing the shared credential, uses the RAM-cached value (originally from **Secrets Manager**).
3. Fires HTTP requests to the target URLs.
4. Writes check results to **SQLite** on **EBS**.
5. On failure: routes alert via `pickRecipients` / `pickSlackWebhook` (Phase 1.27.2 / 1.27.13) → sends via **SES**.

### On audit report generation

1. Node builds an HTML report (project summary, uptime, failure timeline).
2. Uploads to **S3** at `reports/<projectId>/<reportId>.html`.
3. Generates a presigned URL (24-hour validity) for the report.
4. Emails the URL via **SES** to the general-channel recipients.

### On shared-key rotation

1. Update the secret value in the AWS console (Secrets Manager).
2. SSH into EC2 → `sudo systemctl restart monitor-suite`.
3. Node re-fetches the secret at boot → picks up the new value. Zero downtime beyond the ~2-second restart.

---

## 7. Step-by-step deployment plan

### Phase 1A — AWS setup (~1 hour)

1. **Region:** us-east-1 (cheapest, most services).
2. **SSH key pair:** generate `monitor-suite-key.pem` in the EC2 console; save locally.
3. **Security group:** `monitor-suite-sg`
   - Inbound: TCP 22 (SSH, my IP only), TCP 4000 (app, `0.0.0.0/0` — infra team will lock down later).
   - Outbound: all (default).
4. **Request SES production access:** submit form in SES console. Typically approved within 24 hours.

### Phase 1B — Storage + secrets setup (~30 min)

5. **Create S3 bucket:** `monitor-suite-storage-<random>` in us-east-1, block all public access, enable versioning.
6. **Create Secrets Manager secret:** name `/monitor-suite/shared-api-key`, plaintext value = the shared API key. Note the ARN.

### Phase 1C — IAM user (~20 min)

7. **Create user:** `monitor-app-user`, programmatic access only.
8. **Attach inline policy** (JSON from section 5.6 — SES + S3 + Secrets Manager grants, scoped to our bucket + secret).
9. **Save access key + secret key** — will go into `.env`.

### Phase 1D — Launch EC2 (~30 min)

10. **AMI:** Ubuntu Server 24.04 LTS (free tier eligible AMI).
11. **Instance type:** t3.small.
12. **EBS:** 20 GB gp3, delete on termination = **off**.
13. **Security group:** attach `monitor-suite-sg`.
14. **SSH key:** attach `monitor-suite-key.pem`.
15. **Launch.** Note the public IPv4 address.

### Phase 1E — Deploy the app (~1.5 hours)

16. SSH in: `ssh -i monitor-suite-key.pem ubuntu@<ec2-ip>`.
17. Install Node 20 LTS (via NodeSource) + git + build tools.
18. `git clone https://github.com/Pathuri-Deepesh/AI-Functional-Monitoring-Suite.git /app`
19. `cd /app && npm run install:all && npm run build`
20. Create `backend/.env`:
    ```
    AWS_ACCESS_KEY_ID=<key>
    AWS_SECRET_ACCESS_KEY=<secret>
    AWS_REGION=us-east-1
    S3_BUCKET_NAME=monitor-suite-storage-<random>
    SHARED_KEY_SECRET_ARN=arn:aws:secretsmanager:us-east-1:...:secret:/monitor-suite/shared-api-key-XXXX
    SES_FROM_ADDRESS=monitor-alerts@company.com
    ```
    `chmod 600 backend/.env`.
21. Write systemd unit `/etc/systemd/system/monitor-suite.service`, enable + start.
22. `sudo systemctl status monitor-suite` → confirm active.

### Phase 1F — Verify (~30 min)

23. Browser: `http://<ec2-ip>:4000` → app loads, can log in, create a project.
24. Upload a binary file to a flow step → verify in S3 console the object exists at `uploads/<projectId>/<uploadId>`.
25. Trigger a monitor failure (add a URL that returns 500) → verify SES email arrives.
26. Trigger an audit report → verify S3 has the HTML at `reports/...` and the emailed presigned URL loads.
27. `sudo systemctl restart monitor-suite` → verify app reboots cleanly and Secrets Manager fetch succeeds (check logs: `journalctl -u monitor-suite -n 50`).

### Phase 1G — Snapshot + handoff (~30 min)

28. Take a manual EBS snapshot (rollback point).
29. Write short handoff README for infra team: EC2 IP, port 4000, security group name, S3 bucket name, IAM user name, contact info.

### Phase 2 — Infra team (their timeline)

- Point `monitor.company.com` at the EC2 IP.
- Terminate HTTPS on their reverse proxy → forward to `<ec2-ip>:4000`.
- Tighten security group inbound to their proxy IP only.

---

## 8. Code changes required

Two small additive changes. Neither blocks Phase 1 deploy — they can ship as Phase 1.5 before Phase 1F verification, or as a follow-up after Phase 1 is live with local storage.

### 8.1 S3 for uploads and reports (~1 day)

- New file `backend/src/storage.ts` — thin wrapper around `@aws-sdk/client-s3` with `putObject(key, buffer)`, `getObject(key)`, `deleteObject(key)`, `presignUrl(key, ttl)`.
- Swap `fs.writeFileSync('./data/uploads/...')` → `storage.putObject('uploads/...')` in 4–6 code sites (upload endpoints, report generator, cleanup jobs).
- No SQLite schema changes — file *paths* stored in DB become S3 keys instead of local paths.

### 8.2 Secrets Manager for the shared API key (~2 hours)

- New file `backend/src/secrets.ts` — `GetSecretValueCommand` + module-level cache + `getSharedApiKey()` accessor.
- Call at boot: `await loadSharedApiKey()` before starting the monitor loop.
- Replace direct `.env` reads of the shared key with `getSharedApiKey()` calls.

### 8.3 npm dependencies

Add to `backend/package.json`:
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `@aws-sdk/client-secrets-manager`
- `@aws-sdk/client-ses`

(Roughly 8 MB of node_modules; negligible.)

### 8.4 Nothing else changes

- Auth, monitor loop, notifications routing (Phase 1.27.2 + 1.27.13), flow runner, audit generator — all untouched.
- SQLite schema — untouched.
- Frontend — untouched.
- Deployment pipeline — same `npm run build` + `npm start` shape.

---

## 9. Cost breakdown

| Line item | Monthly |
|---|---|
| EC2 t3.small on-demand (us-east-1) | $15.18 |
| EBS 20 GB gp3 | $1.60 |
| S3 storage (~5 GB) + requests | $0.50 |
| Secrets Manager (1 secret) | $0.40 |
| SES (under free tier from EC2) | $0.00 |
| IAM user | $0.00 |
| systemd | $0.00 |
| EBS snapshot (~1 GB used, 1 snapshot) | $0.10 |
| Data transfer out (small) | $0.20 |
| **Total** | **~$18/month** |

Scales linearly with EC2 size if we ever need more compute. All other line items stay flat.

---

## 10. Rejected alternatives (why not X?)

| Option | Why not |
|---|---|
| AWS Lambda | Wrong shape — continuous cron loop, needs SQLite, would require DynamoDB rewrite. |
| AWS Fargate + EFS | `fsync()` latency (10–50ms/write) would kill monitor tick performance. |
| AWS Elastic Beanstalk | Assumes stateless multi-instance apps; our app is stateful single-instance. Adds abstraction without benefit. |
| AWS CDK / Terraform | 5 resources set up once — code-as-infra adds ~2 days of scaffolding for zero payoff at this scale. Console clicks are faster and clearer for the audit trail. |
| RDS (managed PostgreSQL) | +$15/mo minimum; SQLite handles our load fine (~2 writes/sec). Migrate later if concurrency needs it. |
| ALB (Application Load Balancer) | +$18/mo; single EC2 means no load to balance. HTTPS handled by infra team's reverse proxy in Phase 2. |
| CloudFront + S3 static hosting for frontend | App is bundled single-server (Phase 1.27.10); splitting adds CORS + deploy complexity for no user-visible benefit. |
| WAF (Web Application Firewall) | $5+/mo; internal tool behind corporate network in Phase 2 — no public attack surface to protect. |
| DLM (automated snapshot lifecycle) | Overkill for Phase 1; one manual snapshot as rollback point is enough. Add later if data grows. |
| KMS envelope encryption for per-project user vault | Not needed — team decided on one shared key via Secrets Manager instead of per-project user keys. |

---

## 11. Operational runbook (post-deploy)

### Restart the app
```
sudo systemctl restart monitor-suite
```

### View live logs
```
sudo journalctl -u monitor-suite -f
```

### Deploy new code
```
cd /app
git pull
npm run build
sudo systemctl restart monitor-suite
```

### Rotate the shared API key
1. Update secret value in Secrets Manager console.
2. `sudo systemctl restart monitor-suite`.

### Rotate the IAM user access key
1. Create new access key for `monitor-app-user` in IAM console.
2. Update `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` in `backend/.env`.
3. `sudo systemctl restart monitor-suite`.
4. Delete old access key in IAM console.

### Roll back to snapshot
1. Stop EC2 instance.
2. Detach current EBS volume.
3. Create new volume from snapshot.
4. Attach + start EC2.

### Restore an accidentally-deleted S3 file
S3 versioning is enabled; use "Show versions" in the S3 console and restore the prior version.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| EC2 disk fills up | Monitor disk via CloudWatch; SQLite grows slowly (~30 MB/mo); uploads/reports live in S3 so this shouldn't happen. |
| App crash loop | systemd `Restart=always` recovers automatically; alert if `RestartSec` triggers repeatedly. |
| SES sandbox limit hits | Requested production access during Phase 1A; verify before Phase 1F. |
| AWS key leak | IAM user permissions scoped to 3 actions on named resources; blast radius contained. Rotate key + restart app. |
| EBS volume failure | Manual snapshot after deploy; restore in ~15 min. |
| S3 accidental deletion | Versioning enabled; prior versions recoverable. |
| Secrets Manager unavailable at boot | App crashes → systemd restarts → retries. AWS SLA is 99.9%; failure is rare and self-heals. |
| Phase 2 handoff blocked | App works on the raw IP in the meantime; no dependency. |

---

## 13. What "done" looks like

**Phase 1 is done when:**
- App reachable at `http://<ec2-ip>:4000`.
- Login works, projects can be created, URLs can be monitored.
- Uploaded files land in S3, not on the EC2 disk.
- Monitor tick failures send SES emails.
- Audit reports upload to S3 and email with a working presigned URL.
- Shared API key is fetched from Secrets Manager at boot (verified in logs).
- systemd auto-restarts the app after a manual `kill`.
- Handoff README delivered to infra team.

**Phase 2 is done when:**
- `monitor.company.com` resolves to the app.
- HTTPS terminates on infra team's proxy.
- Security group locked down to proxy IP.

---

**End of document.**
