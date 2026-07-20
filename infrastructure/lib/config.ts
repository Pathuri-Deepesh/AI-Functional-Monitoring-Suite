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
  },
};
