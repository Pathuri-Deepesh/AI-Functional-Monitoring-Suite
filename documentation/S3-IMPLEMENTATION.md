# Phase 1.29 — S3 for uploads & reports

**Chosen behavior:** fail loud on S3 outage. Skip backfill — new files go to S3, old files stay on EBS.
**Prepared:** 2026-07-09

---

## Part A — AWS Console (your side, ~10 min)

### A.1 — Create the S3 bucket

1. AWS Console → search **S3** → click **Amazon S3**
2. Confirm region dropdown (top-right, next to your account name) shows **N. Virginia (us-east-1)** — if not, click it and switch
3. Click the orange **Create bucket** button (top-right)

You'll land on a long form. Go top to bottom — here's **every section you'll see**:

**General configuration**
4. **Bucket type:** two cards — "General purpose" vs "Directory". Leave **General purpose** selected (default) — do NOT click Directory.
5. **Bucket name:** type `monitor-suite-storage-deepesh-2026`
   - Must be globally unique across ALL of AWS (not just your account). If you see a red "This bucket name already exists" error, add random digits, e.g. `monitor-suite-storage-deepesh-2026-47`.
6. **Copy settings from existing bucket** (optional collapsible link) — ignore, leave it collapsed/unset

**Object Ownership**
7. Radio buttons: "ACLs disabled (recommended)" vs "ACLs enabled". Leave **ACLs disabled (recommended)** selected — this is the default, do not touch it.

**Block Public Access settings for this bucket**
8. One big checkbox: "Block all public access" — leave it **CHECKED** (this is the default). Underneath it are 4 sub-items that grey out when the main box is checked — you don't need to touch those individually, the single checkbox controls all 4. We want everything blocked since files are private.

**Bucket Versioning**
9. Two radios: "Disable" (default) / "Enable". Click to select **Enable** — this is the one setting you're changing from default, so we can recover a file if it's accidentally overwritten or deleted.

**Tags** (optional, collapsible section)
10. Leave empty — no key/value pairs needed. Skip this section entirely.

**Default encryption**
11. **Encryption type:** two radios — "Server-side encryption with Amazon S3 managed keys (SSE-S3)" vs "...AWS KMS keys (SSE-KMS)". Leave **SSE-S3** selected — this is the default, do not switch to KMS (KMS costs extra and we don't need it).
12. **Bucket Key:** toggle, only relevant if you'd chosen KMS above. Leave as-is (default) — irrelevant since we're on SSE-S3.

**Advanced settings**
13. **Object Lock:** "Disable" / "Enable" radios. Leave **Disable** selected (default) — Object Lock is for regulatory/compliance write-once-read-many use cases, not needed here. Note: this cannot be changed after bucket creation, but Disable is correct for us.

**Bottom of page**
14. Click the orange **Create bucket** button
15. You'll see a green success banner and land back on the bucket list, with your new bucket showing at the top
16. **Copy the exact bucket name** you ended up with (check if AWS appended digits) into your scratch file — you'll need it for `.env`:
    ```
    === S3 ===
    S3_BUCKET_NAME=monitor-suite-storage-deepesh-2026
    ```

### A.2 — Add S3 permissions to the IAM user

The `monitor-app-user` IAM user currently only has Secrets Manager permission. Now we add S3 too.

1. AWS Console → search **IAM** → click **IAM**
2. Left sidebar → **Users** → click **monitor-app-user**
3. **Permissions** tab → find the existing inline policy `monitor-app-secrets-access`
4. Click on the policy name → click **Edit**
5. Click **JSON** tab
6. Replace the entire JSON with this (adds S3 alongside Secrets Manager):

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
    },
    {
      "Sid": "S3StorageAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::monitor-suite-storage-deepesh-2026/*"
    }
  ]
}
```

*(Replace `monitor-suite-storage-deepesh-2026` with your actual bucket name if you used different digits.)*

7. Click **Next** → **Save changes**

### A.3 — Verify permission works

Nothing to click — I'll test from code once you tell me the bucket name.

---

## Part B — Code (my side)

Nothing for you to do here — I'll write it after Part A.

Wiring plan:
- New `backend/src/storage.ts` — S3 wrapper
- Modify 4 call sites in `app.ts` + `audit.ts` to prefer S3 when `S3_BUCKET_NAME` env var is set
- Fallback path: if env var is missing, use local disk (same as before) — no breakage on dev laptops without AWS

---

## Part C — Deploy (~15 min)

1. Add `S3_BUCKET_NAME=<name>` to local `backend/.env`
2. Test locally: upload a file → check S3 console for the object
3. `scp .env` to EC2 → restart service
4. Test on prod: upload a file → check S3 console

---

## When you finish Part A

Reply with:
- **"bucket done: monitor-suite-storage-<your-suffix>"**

Then I write the code.
