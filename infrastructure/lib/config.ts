export interface EnvConfig {
  /** Short environment name — used as a suffix on every resource name. */
  envName: "dev" | "staging" | "prod";
  /** AWS region — matches every AWS service already used by the app (S3, Secrets Manager, SES). */
  region: string;
  /** EC2 instance type behind the Elastic Beanstalk environment. */
  instanceType: string;
  /**
   * Elastic Beanstalk platform (Node.js version) — must be Node >= 22 for node:sqlite.
   * AWS retires old platform versions on a rolling basis, so this ARN can go stale.
   * If a deploy fails with "No Platform named ... found", refresh it via:
   *   aws elasticbeanstalk list-platform-versions --filters '[{"Type":"PlatformName","Operator":"=","Values":["Node.js 22 running on 64bit Amazon Linux 2023"]}]'
   * and use the one marked "Recommended".
   */
  ebPlatformArn: string;
  /** Size (GB) of the persistent EBS volume mounted at /app/data — survives instance replacement. */
  ebsVolumeSizeGb: number;
  /** CIDR allowed to reach SSH (22) and the app port (4000). */
  allowedCidr: string;
  /** Port the Node app listens on (matches backend/src/app.ts PORT default). */
  appPort: number;
  /**
   * Availability zones to exclude when picking subnets for the EB instance.
   * The default VPC has a subnet in every AZ, but not every AZ offers every
   * instance type — us-east-1e in particular lacks t3.small (and many other
   * modern types). EB validates the instance type against ALL subnets you give
   * it and fails if any one AZ can't provide it, so we drop those AZs here.
   * Verify with:
   *   aws ec2 describe-instance-type-offerings --location-type availability-zone \
   *     --filters Name=instance-type,Values=<instanceType> --query "InstanceTypeOfferings[].Location"
   */
  excludeAzs: string[];
  /**
   * How many daily EBS snapshots of the data volume to retain (AWS Data Lifecycle
   * Manager takes one per day and auto-deletes the oldest once this count is
   * exceeded). 14 = a rolling two weeks of backups.
   */
  snapshotRetainCount: number;
  /**
   * ACM certificate ARN (MUST be in the same region, us-east-1) for the ALB's
   * HTTPS:443 listener. This is what makes the app reachable over https://.
   * Leave "" for an env that isn't ready to deploy HTTPS yet — the stack throws
   * a clear error rather than creating a broken listener if it's empty at deploy.
   */
  lbCertificateArn: string;
  /**
   * ALB scheme: "internet-facing" (public ALB, still firewalled to allowedCidr
   * via its security group) or "internal" (only reachable inside the VPC).
   * We use internet-facing + office-CIDR-locked SG to mirror the current setup.
   */
  elbScheme: "internet-facing" | "internal";

  // ── Provided-VPC deployment (the `-vpc` env) ──────────────────────────────
  // The original `-lb` env runs in the account's DEFAULT VPC, which has no route
  // into Logitech's private `np.logitech.io` network — so the app can reach the
  // (public) prod CMS but NOT the (private) dev CMS. DevOps handed over a private
  // VPC + subnets that DO have that route (NAT + a 172.16.0.0/12 route toward the
  // corp network). Setting `useProvidedVpc: true` makes the `-vpc` stack deploy
  // into that VPC instead of the default one. Leave false and these unused for
  // the default-VPC envs.
  /** When true, the `-vpc` stack deploys into the provided VPC/subnets below. */
  useProvidedVpc: boolean;
  /** The DevOps-provided VPC id (e.g. vpc-06512a0b94e582a99). */
  providedVpcId: string;
  /**
   * Private subnet the EC2 instance runs in. Its AZ pins the EBS data volume's
   * AZ (an EBS volume attaches only within its own AZ), so this must stay stable.
   */
  providedInstanceSubnetId: string;
  /**
   * The AZ of providedInstanceSubnetId (e.g. "us-east-1a"). CDK cannot read a
   * subnet's AZ from an id-only reference, so it's stated explicitly and MUST
   * match the real AZ of that subnet (verify with `aws ec2 describe-subnets`).
   */
  providedInstanceSubnetAz: string;
  /**
   * Subnets the (internal) ALB spans — must be >=2 AZs. Include the instance
   * subnet's AZ plus at least one more.
   */
  providedElbSubnetIds: string[];
  /**
   * Sender ("From") address for SES failure/audit emails. Must be an address
   * already VERIFIED in SES for this region. Optional — if omitted, the app
   * runs fine and just reports "SES not configured" (sends no email).
   * Recipients are configured per-project in the app UI, not here.
   */
  sesFromEmail?: string;
}

/**
 * All three environments share identical values today — deliberate choice so the
 * scaffold proves out end-to-end for `dev` first. Differentiating staging/prod later
 * (bigger instance, tighter CIDR, etc.) is a one-line edit here, not a code change.
 *
 * allowedCidr is set to the office's public IP (14.97.45.226/32) — same CIDR
 * currently used on `monitor-suite-sg` for the live manually-created EC2 instance.
 * If the office IP ever changes, update this value and redeploy.
 */
export const ENVS: Record<string, EnvConfig> = {
  dev: {
    envName: "dev",
    region: "us-east-1",
    instanceType: "t3.small",
    ebPlatformArn:
      "arn:aws:elasticbeanstalk:us-east-1::platform/Node.js 22 running on 64bit Amazon Linux 2023/6.11.3",
    ebsVolumeSizeGb: 20,
    allowedCidr: "14.97.45.226/32",
    appPort: 4000,
    excludeAzs: ["us-east-1e"],
    snapshotRetainCount: 14,
    // PASTE YOUR ACM CERT ARN (us-east-1) FOR monitor-cloudservices.np.logitech.io HERE:
    lbCertificateArn: "arn:aws:acm:us-east-1:443555584785:certificate/3947f99c-b2c0-4b37-ab0b-df69a6329014",
    elbScheme: "internet-facing",
    // DevOps-provided private VPC that has a route into the corp/internal network
    // (NAT + 172.16.0.0/12 route) so the app can reach the PRIVATE dev CMS
    // (dev-campaign-service-cms.np.logitech.io). The `-vpc` env uses these.
    // ALB is INTERNAL here (all provided subnets are private), so `elbScheme`
    // above is overridden to "internal" for the `-vpc` stack.
    useProvidedVpc: true,
    providedVpcId: "vpc-06512a0b94e582a99",
    providedInstanceSubnetId: "subnet-09ffd52a605e20af0", // us-east-1a, 172.30.207.0/24
    providedInstanceSubnetAz: "us-east-1a",
    providedElbSubnetIds: [
      "subnet-09ffd52a605e20af0", // us-east-1a (57 free IPs)
      "subnet-08d625f378b17e0e8", // us-east-1b, 172.30.204.128/25 (112 free IPs)
      // NOTE: subnet-07771cba76e16c946 (1b) was tried first but has only 1 free
      // IP; an ALB needs >=8 free IPs per subnet, so it failed. Use this 1b one.
    ],
    // SES sender for failure/audit emails — already verified in SES (us-east-1).
    sesFromEmail: "dp1@logitech.com",
  },
  staging: {
    envName: "staging",
    region: "us-east-1",
    instanceType: "t3.small",
    ebPlatformArn:
      "arn:aws:elasticbeanstalk:us-east-1::platform/Node.js 22 running on 64bit Amazon Linux 2023/6.11.3",
    ebsVolumeSizeGb: 20,
    allowedCidr: "14.97.45.226/32",
    appPort: 4000,
    excludeAzs: ["us-east-1e"],
    snapshotRetainCount: 14,
    // staging not deployed yet — fill its own ACM ARN when ready.
    lbCertificateArn: "arn:aws:acm:us-east-1:443555584785:certificate/3947f99c-b2c0-4b37-ab0b-df69a6329014",
    elbScheme: "internet-facing",
    // staging stays on the default VPC for now.
    useProvidedVpc: false,
    providedVpcId: "",
    providedInstanceSubnetId: "",
    providedInstanceSubnetAz: "",
    providedElbSubnetIds: [],
  },
  prod: {
    envName: "prod",
    region: "us-east-1",
    instanceType: "t3.small",
    ebPlatformArn:
      "arn:aws:elasticbeanstalk:us-east-1::platform/Node.js 22 running on 64bit Amazon Linux 2023/6.11.3",
    ebsVolumeSizeGb: 20,
    allowedCidr: "14.97.45.226/32",
    appPort: 4000,
    excludeAzs: ["us-east-1e"],
    snapshotRetainCount: 14,
    // prod not deployed yet — fill its own ACM ARN when ready.
    lbCertificateArn: "arn:aws:acm:us-east-1:443555584785:certificate/3947f99c-b2c0-4b37-ab0b-df69a6329014",
    elbScheme: "internet-facing",
    // prod stays on the default VPC for now.
    useProvidedVpc: false,
    providedVpcId: "",
    providedInstanceSubnetId: "",
    providedInstanceSubnetAz: "",
    providedElbSubnetIds: [],
  },
};
