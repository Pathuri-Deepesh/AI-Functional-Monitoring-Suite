# Infrastructure (CDK)

AWS CDK (TypeScript) definitions for the AI-Powered Functional Monitoring Suite —
dev, staging, and prod environments, each as an independent CloudFormation stack.

**Only `dev` is deployed today.** `staging` and `prod` are fully defined and will
synthesize successfully, but must not be deployed without explicit sign-off —
`cdk deploy MonitorSuite-staging` or `MonitorSuite-prod` creates real, billable
AWS resources.

This is separate, additive infrastructure. It does **not** touch, import, or
replace the currently-live manually-created resources described in
[`../documentation/DEPLOYMENT-PLAN.md`](../documentation/DEPLOYMENT-PLAN.md) and
[`../documentation/EC2-DEPLOYMENT-GUIDE.md`](../documentation/EC2-DEPLOYMENT-GUIDE.md).
Deploying `dev` creates a parallel set of `-dev`-suffixed resources alongside
whatever is already running.

## What gets created (per environment)

- S3 bucket (`monitor-suite-storage-<env>`) — versioned, all public access blocked, SSE-S3
- Secrets Manager secret (`/monitor-suite/<env>/project-api-keys`)
- IAM Role + instance profile, scoped to exactly: S3 CRUD on this stack's bucket,
  Secrets Manager get/put on this stack's secret, SES send
- Security group — SSH (22) and app port (4000), both restricted to the office CIDR
- A standalone, persistent EBS volume for `/app/data` (survives instance replacement —
  see [`.ebextensions/01-mount-data-volume.config`](.ebextensions/01-mount-data-volume.config))
- Elastic Beanstalk application + single-instance environment (Node.js 22 platform)

Single-instance, not load-balanced: the app writes SQLite directly to local disk with
`node:sqlite`, so more than one instance writing the same file isn't safe.

## Why Elastic Beanstalk + a separate EBS volume

EB instances are disposable — replaced on deploys, health events, or scaling. A SQLite
file living on the instance's own root volume would be silently wiped on replacement.
The `.ebextensions` script attaches and mounts a separate, persistent EBS volume at
`/app/data` before the app starts, so the database (and any local-disk fallback
uploads/reports) survive instance replacement. This is the one thing worth verifying
after first deploy (see step 7 below).

## Idempotency

This is CloudFormation's native behavior — nothing custom was written for it. Every
`cdk deploy` diffs the running stack against the code and updates only what changed.
Running `cdk deploy MonitorSuite-dev` again with no changes is a no-op: no errors, no
duplicate resources.

## One-time setup

```bash
cd infrastructure
npm install
npx cdk bootstrap   # once per AWS account/region — safe to re-run
```

## Commands

```bash
npx cdk synth                        # generate CloudFormation for all 3 stacks
npx cdk diff MonitorSuite-dev        # preview changes before deploying
npx cdk deploy MonitorSuite-dev      # deploy dev (prompts to review + approve)
npx cdk destroy MonitorSuite-dev     # tear down dev (cost control)
```

Before the first deploy, replace the `<office-ip>/32` placeholder in
[`lib/config.ts`](lib/config.ts) with the real office IP (same CIDR already used on the
live manual security group).

After deploy, `SES_FROM_EMAIL` must be set manually in the EB console once the sender
identity is verified for that environment — it's intentionally not hardcoded here (see
`../backend/.env.example`).

## Verification checklist (dev)

1. `npm install` succeeds
2. `npx cdk synth` succeeds for all 3 stacks with zero errors
3. `npx cdk bootstrap` (one-time)
4. `npx cdk diff MonitorSuite-dev` shows only new `-dev` resources — nothing touching live infra
5. `npx cdk deploy MonitorSuite-dev` completes
6. EB environment health is green; app reachable on port 4000 at the EB URL
7. SSH in, `df -h` confirms `/app/data` is the separate volume, not root
8. Trigger a redeploy/restart and confirm `/app/data` (the SQLite file) survives — the
   actual proof the persistence fix works, not just that it deployed once

## Known, pre-existing doc issues (not fixed here, out of scope)

- `EC2-DEPLOYMENT-GUIDE.md` installs Node 20; the app requires Node ≥ 22 for `node:sqlite`
- `DEPLOYMENT-PLAN.md` references `@aws-sdk/client-ses` (v1); the code uses `client-sesv2`
