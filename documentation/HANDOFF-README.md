# Monitor Suite — Handoff Notes

**App:** AI-Powered Functional Monitoring Suite
**Live at:** http://18.215.189.244:4000
**AWS account:** Logitech CPG Dev (443555584785)
**Region:** us-east-1
**Owner:** Deepesh P
**Deployed:** 2026-07-08

---

## For the infra team — what I need from you

1. Point a corporate subdomain (e.g., `monitor.company.com`) at **18.215.189.244**
2. Terminate HTTPS on your reverse proxy and forward `:443` → `18.215.189.244:4000`
3. Tighten the security group `monitor-suite-sg` — restrict port 4000 inbound to your proxy IP only (currently open to `0.0.0.0/0`)

Everything else is done and running on my side.

---

## AWS resources I created

| Resource | Name / ID | Purpose |
|---|---|---|
| EC2 instance | `monitor-suite-prod` (i-05b02d9a930ed7a1c) | t3.small, Ubuntu 26.04, always-on |
| EBS volume | 20 GB gp3, attached to EC2 | Holds OS + app + SQLite DB |
| EBS snapshot | `initial-deploy-2026-07-08` | Rollback point |
| Security group | `monitor-suite-sg` | Port 22 (SSH from my IP) + port 4000 (0.0.0.0/0 — please tighten) |
| SSH key pair | `monitor-suite-key` | Private key held by me |
| Secrets Manager | `/monitor-suite/project-api-keys` | JSON blob mapping project ID → API key |
| IAM user | `monitor-app-user` | App's AWS identity; scoped inline policy |

---

## Operations cheat sheet

**SSH in:**
```bash
ssh -i ~/.ssh/monitor-suite-key.pem ubuntu@18.215.189.244
```

**Restart the app:**
```bash
sudo systemctl restart monitor-suite
```

**Watch live logs:**
```bash
sudo journalctl -u monitor-suite -f
```

**Deploy a new version:**
```bash
cd /app
git pull
npm run build
sudo systemctl restart monitor-suite
```

**Rotate the AWS credentials in `.env`:**
```bash
sudo nano /app/backend/.env
sudo systemctl restart monitor-suite
```

**Roll back to snapshot:**
1. Stop EC2 instance
2. Detach the current EBS volume
3. Create a new volume from `initial-deploy-2026-07-08`
4. Attach it and start the EC2

---

## Data locations

| Data | Where |
|---|---|
| SQLite database | `/app/backend/data/db.sqlite` (on EBS) |
| App code | `/app/backend/` + `/app/frontend/` (on EBS) |
| Environment config | `/app/backend/.env` (chmod 600, ubuntu-owned) |
| Systemd unit | `/etc/systemd/system/monitor-suite.service` |
| App logs | `sudo journalctl -u monitor-suite` |
| Project API keys (durable) | AWS Secrets Manager `/monitor-suite/project-api-keys` |

---

## Cost estimate

~$18/month (EC2 t3.small $15 + EBS 20 GB $2 + Secrets Manager 1 secret $0.40 + snapshot + minor transfer).

---

## Known follow-ups (my Phase 2 work, not the infra team's)

- Move uploads + reports from EBS → S3 bucket (Phase 1.29, not yet built)
- Move to SES for outbound email + request SES production access (currently sandboxed to 200 emails/day to verified addresses only)

---

## Contact

Deepesh P — leaving in a few weeks. If something breaks after that, the runbook above should cover most cases. Repo history + `documentation/PROGRESS.md` + `documentation/DEPLOYMENT-PLAN.md` explain the architecture and every past phase.
