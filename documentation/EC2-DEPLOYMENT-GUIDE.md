# EC2 Deployment Guide — AI-Functional-Monitoring-Suite

**Goal:** Get the app running live on AWS EC2 at `http://<ec2-ip>:4000`.
**Path B chosen:** Deploy now with Secrets Manager working; S3 for uploads added later.
**Total time:** ~4 hours (excluding SES approval wait time).
**Prepared:** 2026-07-08

---

## Table of Contents

1. [Before you start](#1-before-you-start)
2. [Phase A — Launch EC2 instance](#phase-a--launch-ec2-instance)
3. [Phase B — SSH in and prepare the box](#phase-b--ssh-in-and-prepare-the-box)
4. [Phase C — Clone repo and build the app](#phase-c--clone-repo-and-build-the-app)
5. [Phase D — Set up `.env` on the box](#phase-d--set-up-env-on-the-box)
6. [Phase E — systemd service (auto-start on boot)](#phase-e--systemd-service-auto-start-on-boot)
7. [Phase F — Request SES production access](#phase-f--request-ses-production-access)
8. [Phase G — Smoke test end-to-end](#phase-g--smoke-test-end-to-end)
9. [Phase H — Backup snapshot + handoff README](#phase-h--backup-snapshot--handoff-readme)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Before you start

You need:

- [ ] AWS account access (same one you used for Secrets Manager — Logitech CPG Dev)
- [ ] SSH client on your laptop (Windows: PowerShell has `ssh` built-in)
- [ ] Your Secrets Manager ARN (from Phase 1.28 — already in your scratch file)
- [ ] Your `monitor-app-user` access key + secret key (already in your scratch file)
- [ ] ~30 min uninterrupted for Phase A

---

## Phase A — Launch EC2 instance

### A.1 — Log in and set region

1. Go to **https://console.aws.amazon.com/**
2. Sign in.
3. Top-right corner → confirm region is **N. Virginia (us-east-1)**. If not, click and switch.

### A.2 — Open the EC2 service

1. Top search bar → type **EC2** → press Enter.
2. Click **EC2** in the results.
3. You'll land on the EC2 dashboard.

### A.3 — Create SSH key pair

Before launching an instance, we need a key to SSH into it.

1. Left sidebar → scroll down to **Network & Security** section → click **Key Pairs**.
2. Click orange **Create key pair** button (top-right).
3. **Name:** type `monitor-suite-key`
4. **Key pair type:** select **RSA**
5. **Private key file format:** select **.pem**
6. Click **Create key pair**.
7. Browser will auto-download `monitor-suite-key.pem`.
8. **Move that file to a safe location** — for example `C:\Users\dp1\.ssh\monitor-suite-key.pem`
9. **Windows only — restrict permissions.** Open PowerShell and run:
   ```powershell
   icacls C:\Users\dp1\.ssh\monitor-suite-key.pem /inheritance:r
   icacls C:\Users\dp1\.ssh\monitor-suite-key.pem /grant:r "$($env:USERNAME):(R)"
   ```
   Without this, SSH will refuse to use the key.

### A.4 — Create a security group

1. Left sidebar → **Network & Security** → **Security Groups**.
2. Click orange **Create security group** button.
3. **Security group name:** `monitor-suite-sg`
4. **Description:** `Allow SSH from my IP + app port 4000`
5. **VPC:** leave default
6. Scroll to **Inbound rules** → click **Add rule**:
   - **Type:** SSH
   - **Source:** **My IP** (auto-fills your current public IP)
7. Click **Add rule** again:
   - **Type:** Custom TCP
   - **Port range:** `4000`
   - **Source:** **Anywhere-IPv4** (`0.0.0.0/0`)
   - *(Infra team will lock this down later. For now open so you can hit it from your browser.)*
8. Leave **Outbound rules** as default (all traffic allowed out).
9. Click **Create security group** (bottom-right).

### A.5 — Launch the EC2 instance

1. Left sidebar → **Instances** (top of the sidebar) → click orange **Launch instances** button (top-right).
2. **Name:** `monitor-suite-prod`
3. **Application and OS Images:**
   - Select **Ubuntu** tab.
   - Amazon Machine Image (AMI): pick **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type** (has "Free tier eligible" label).
   - Architecture: leave **64-bit (x86)**.
4. **Instance type:**
   - Select **t3.small** from the dropdown.
   - *(2 vCPU, 2 GB RAM — right size for our workload.)*
5. **Key pair (login):**
   - Select `monitor-suite-key` from the dropdown.
6. **Network settings:**
   - Click **Edit** (top-right of that section).
   - **VPC:** leave default.
   - **Subnet:** leave "No preference".
   - **Auto-assign public IP:** **Enable**.
   - **Firewall (security groups):** select **Select existing security group** → pick **monitor-suite-sg**.
7. **Configure storage:**
   - Change size from 8 GiB → **20 GiB**.
   - **Volume type:** leave as **gp3**.
   - Leave **Delete on termination** UNCHECKED (so the disk survives if instance dies).
8. **Advanced details:** leave everything default.
9. Right side → click orange **Launch instance** button.

### A.6 — Get the public IP

1. You'll see a green success page → click **View all instances**.
2. Wait ~2 minutes for **Instance state** = "Running" and **Status check** = "2/2 checks passed" (refresh with the reload icon top-right).
3. Click on your instance name `monitor-suite-prod`.
4. In the details panel, find **Public IPv4 address** — looks like `54.123.45.67`.
5. **Copy it** to your scratch file:
   ```
   === EC2 instance ===
   PUBLIC_IP=54.123.45.67
   ```

---

## Phase B — SSH in and prepare the box

### B.1 — SSH from your laptop

Open **PowerShell** (or Git Bash) on your laptop.

```powershell
ssh -i C:\Users\dp1\.ssh\monitor-suite-key.pem ubuntu@<YOUR_PUBLIC_IP>
```

**First time you connect:** it'll ask "Are you sure you want to continue connecting? (yes/no)". Type `yes` and press Enter.

**If SSH refuses with "Permissions are too open":** re-run the icacls commands from A.3.

**If it hangs forever:** your security group probably didn't include your IP. Go back to A.4 and re-add "SSH from My IP".

You should see a prompt like:
```
ubuntu@ip-172-31-x-x:~$
```

You're on the box.

### B.2 — Update the system

Copy and paste this whole block into the SSH session:

```bash
sudo apt update && sudo apt upgrade -y
```

Takes ~2 minutes. If it prompts about a service restart, press Enter to accept defaults.

### B.3 — Install Node.js 20 LTS

Copy and paste:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:
```bash
node --version   # should print v20.x.x
npm --version    # should print 10.x.x
```

### B.4 — Install build tools + git

```bash
sudo apt install -y git build-essential
```

### B.5 — Create the app directory

```bash
sudo mkdir -p /app
sudo chown ubuntu:ubuntu /app
```

---

## Phase C — Clone repo and build the app

Still in the SSH session:

### C.1 — Clone your repo

```bash
cd /app
git clone https://github.com/Pathuri-Deepesh/AI-Functional-Monitoring-Suite.git .
```

*(The trailing `.` clones into `/app` directly, not into a nested folder.)*

### C.2 — Install dependencies

```bash
npm run install:all
```

Takes ~2 minutes. Ignore any deprecation warnings — they're harmless.

### C.3 — Build the frontend bundle

```bash
npm run build
```

Should end with `[build:copy] copied frontend/dist → backend/public`.

---

## Phase D — Set up `.env` on the box

### D.1 — Copy your local `.env` to the server

**On your LAPTOP** (open a NEW PowerShell — don't close the SSH one):

```powershell
scp -i C:\Users\dp1\.ssh\monitor-suite-key.pem C:\Users\dp1\Desktop\AI-Functional-Monitoring-Suite\backend\.env ubuntu@<YOUR_PUBLIC_IP>:/app/backend/.env
```

That uploads your local `.env` (with the AWS creds you already put there) to the server.

### D.2 — Verify on the server

Switch back to the SSH session. Run:

```bash
ls -la /app/backend/.env
cat /app/backend/.env | grep -E "AWS_|PROJECT_KEYS" | sed 's/=.*/=<REDACTED>/'
```

You should see the 4 keys listed (with values redacted for safety).

### D.3 — Lock down the file

```bash
chmod 600 /app/backend/.env
```

Only the `ubuntu` user can now read it.

---

## Phase E — systemd service (auto-start on boot)

### E.1 — Create the unit file

```bash
sudo tee /etc/systemd/system/monitor-suite.service > /dev/null <<'EOF'
[Unit]
Description=AI-Functional-Monitoring-Suite
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/app
EnvironmentFile=/app/backend/.env
ExecStart=/usr/bin/npm --prefix backend start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### E.2 — Enable + start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable monitor-suite
sudo systemctl start monitor-suite
```

### E.3 — Verify it's running

```bash
sudo systemctl status monitor-suite
```

You should see **Active: active (running)** in green.

Press `q` to exit the status view.

### E.4 — Watch the boot log

```bash
sudo journalctl -u monitor-suite -n 30 --no-pager
```

You should see:
```
[monitoring-backend] serving frontend from /app/backend/public
[secrets] loaded N API keys across M projects
[monitoring-backend] listening on http://127.0.0.1:4000
```

**If you see `[secrets] loaded N API keys...`** — AWS Secrets Manager is reachable from the EC2 ✅

**If you see a crash** — check the last few lines for the error, most common:
- Bad ARN in `.env` → fix and `sudo systemctl restart monitor-suite`
- IAM user missing permission → check the inline policy in AWS console

### E.5 — Test from your browser

Open your laptop's browser:
```
http://<YOUR_PUBLIC_IP>:4000
```

You should see the app's login page. If yes → **you are LIVE** 🎉

---

## Phase F — Request SES production access

Right now SES is in **sandbox mode** — it can only send email to verified addresses, capped at 200/day. We need production access.

### F.1 — Open SES service

1. AWS Console → search **SES** → click **Amazon Simple Email Service**.
2. Left sidebar → **Account dashboard**.
3. You'll see a banner: "Your Amazon SES account is in the sandbox in US East (N. Virginia)".
4. Click **Request production access**.

### F.2 — Fill the form

- **Mail type:** Transactional
- **Website URL:** your GitHub repo URL or a Logitech page
- **Use case description:** paste something like:
  > "Internal monitoring tool for Logitech. Sends alert emails when monitored URLs fail health checks or when scheduled audits complete. Recipients are internal team members who explicitly configure their addresses in the app's Notifications settings. Zero unsolicited email. Volume: under 100 emails/day."
- **Additional contacts:** your email
- **Preferred contact language:** English
- **AWS support terms:** tick the checkbox
- Click **Submit request**

### F.3 — Wait

Approval usually comes within 24 hours by email. Until approved, you can only send to verified addresses (see F.4).

### F.4 — Verify one sender email (immediate)

While waiting for production access:

1. SES left sidebar → **Identities** → **Create identity**.
2. **Identity type:** Email address.
3. **Email address:** an address you control (e.g., `deepesh@logitech.com`).
4. Click **Create identity**.
5. Check that inbox → click the verification link from AWS.

Now your app can send FROM that address (in the meantime, it can only send TO other verified addresses; after production approval, it can send anywhere).

Also add that address to `backend/.env` on the server:

```bash
echo "SES_FROM_ADDRESS=deepesh@logitech.com" >> /app/backend/.env
sudo systemctl restart monitor-suite
```

---

## Phase G — Smoke test end-to-end

Do these in order:

### G.1 — Login works

- Browser: `http://<PUBLIC_IP>:4000` → log in with existing user.

### G.2 — Existing data is there

- Sidebar should show all your projects (they came from GitHub via git clone → but wait, SQLite starts empty on the EC2 since the DB file is not in the repo).
- **You're on a fresh SQLite.** You'll need to recreate projects/keys on the server, OR copy the DB from your laptop.

### G.3 — Copy your local SQLite database to the server (optional but recommended)

On your LAPTOP:

```powershell
scp -i C:\Users\dp1\.ssh\monitor-suite-key.pem C:\Users\dp1\Desktop\AI-Functional-Monitoring-Suite\backend\data\db.sqlite ubuntu@<PUBLIC_IP>:/app/backend/data/db.sqlite
```

Back on the server:

```bash
sudo systemctl restart monitor-suite
```

Refresh the browser → all your projects appear.

### G.4 — Add an API key from the UI

- Settings → API Keys → Add a test key.
- Check AWS console → Secrets Manager → your secret → Retrieve secret value.
- Confirm the new key is there.

### G.5 — Force a URL failure to trigger email

- Create a URL check that will fail (e.g., `https://httpbin.org/status/500`).
- Wait ~30 seconds for the monitor tick.
- Verify an email arrives at your notifications recipient.

### G.6 — Restart-crash test

```bash
sudo systemctl restart monitor-suite
sudo journalctl -u monitor-suite -n 20 --no-pager
```

Should boot cleanly, re-fetch Secrets Manager, resume.

---

## Phase H — Backup snapshot + handoff README

### H.1 — Take an EBS snapshot

1. EC2 console → left sidebar → **Elastic Block Store** → **Volumes**.
2. Find the volume attached to your `monitor-suite-prod` instance.
3. Select it → **Actions** → **Create snapshot**.
4. **Description:** `initial-deploy-2026-07-08`
5. Click **Create snapshot**.
6. Takes ~5 minutes. Rollback point in case anything corrupts.

### H.2 — Write handoff README

On your laptop, create `documentation/HANDOFF-README.md`:

```markdown
# Monitor Suite — Handoff Notes

**App:** AI-Functional-Monitoring-Suite
**Live at:** http://<PUBLIC_IP>:4000
**AWS account:** Logitech CPG Dev (443555584785)
**Region:** us-east-1
**Owner:** Deepesh P (deepesh@logitech.com)

## AWS resources
- **EC2 instance:** monitor-suite-prod (t3.small, Ubuntu 24.04)
- **Security group:** monitor-suite-sg (port 22 + 4000 open)
- **EBS volume:** 20 GB gp3 attached to EC2
- **Secrets Manager:** /monitor-suite/project-api-keys
- **IAM user:** monitor-app-user (access key rotated on <date>)
- **Snapshot:** initial-deploy-2026-07-08 (rollback point)

## For the infra team
- Point `monitor.company.com` → `<PUBLIC_IP>`
- Terminate HTTPS on your reverse proxy → forward to port 4000
- Tighten security group inbound to proxy IP only

## Operations
- Restart: `sudo systemctl restart monitor-suite`
- Logs: `sudo journalctl -u monitor-suite -f`
- Deploy update: `cd /app && git pull && npm run build && sudo systemctl restart monitor-suite`
```

Commit + push it.

---

## 10. Troubleshooting

### `Permission denied (publickey)` when SSHing
- Wrong key file → check the path
- Windows file permissions wrong → re-run icacls from A.3

### Browser can't reach `http://<IP>:4000`
- Security group inbound rule for port 4000 missing → check A.4
- Service not running → `sudo systemctl status monitor-suite` on the box
- Firewall on your work network blocking outbound to port 4000 → try mobile hotspot

### `[secrets] loaded 0 API keys across 0 projects` on prod but you have keys
- Fresh SQLite on prod — recreate keys through UI, OR do G.3 to copy your local DB up

### `AccessDeniedException` in the boot log
- IAM user missing permission on the specific secret ARN → check inline policy in AWS console
- ARN in `.env` doesn't match the actual secret ARN → double-check

### `EACCES` errors on the box
- File permissions issue → `sudo chown -R ubuntu:ubuntu /app`

### The service keeps restarting in a loop
```bash
sudo journalctl -u monitor-suite -n 100 --no-pager
```
Find the actual error (usually an env-var or DB issue), fix, restart.

---

**End of guide.**
