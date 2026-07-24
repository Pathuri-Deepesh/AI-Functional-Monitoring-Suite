import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elasticbeanstalk from "aws-cdk-lib/aws-elasticbeanstalk";
import type { EnvConfig } from "./config";

export interface MonitorSuiteStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * One environment's worth of infrastructure for the Monitoring Suite: S3 (uploads),
 * Secrets Manager (per-project API keys), an IAM role scoped to exactly those two plus
 * SES send, a locked-down security group, a persistent EBS volume for the SQLite database,
 * and an Elastic Beanstalk single-instance environment running the app.
 *
 * Every resource name is suffixed with the environment name so dev/staging/prod can
 * coexist in the same account without collisions. CloudFormation (which CDK compiles to)
 * is idempotent by nature: re-running `cdk deploy` on an unchanged stack is a no-op,
 * and on a changed stack it updates only the diff — nothing here needs bespoke
 * "does this already exist" checks.
 */
export class MonitorSuiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitorSuiteStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { envName } = config;

    // ── Network: reuse the account's default VPC. No new VPC, no NAT gateway —
    // keeps this additive and cheap. Matches the current manual setup, which also
    // runs in the default VPC.
    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    // ── S3 bucket for uploaded files (backend/src/storage.ts). Settings mirror the
    // real bucket documented in documentation/S3-IMPLEMENTATION.md: versioning on,
    // all public access blocked, SSE-S3 encryption.
    const uploadsBucket = new s3.Bucket(this, "UploadsBucket", {
      bucketName: `monitor-suite-storage-${envName}`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Secrets Manager secret for per-project API keys (backend/src/secrets.ts,
    // PROJECT_KEYS_SECRET_ARN). Seeded with the empty-cache shape the app already
    // expects on first boot.
    const projectKeysSecret = new secretsmanager.Secret(this, "ProjectKeysSecret", {
      secretName: `/monitor-suite/${envName}/project-api-keys`,
      description: `Monitoring Suite (${envName}) - per-project API key vault, written through from the app.`,
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ _meta: { version: 1 } })
      ),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── IAM role for the Elastic Beanstalk EC2 instance. Scoped to exactly the 3
    // actions the app needs — no wildcards, no admin. Role (not a long-lived IAM
    // user) so credentials never live in a .env file at all; the SDK picks them up
    // automatically via instance metadata.
    const instanceRole = new iam.Role(this, "InstanceRole", {
      roleName: `monitor-suite-instance-role-${envName}`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        // Required by every EB-managed EC2 instance for health reporting + log/log-group access.
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AWSElasticBeanstalkWebTier"
        ),
      ],
    });

    uploadsBucket.grantReadWrite(instanceRole);
    projectKeysSecret.grantRead(instanceRole);
    projectKeysSecret.grantWrite(instanceRole);

    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "SesSendOnly",
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"], // SES has no per-identity resource ARN to scope to — matches existing policy.
      })
    );

    const instanceProfile = new iam.CfnInstanceProfile(this, "InstanceProfile", {
      instanceProfileName: `monitor-suite-instance-profile-${envName}`,
      roles: [instanceRole.roleName],
    });

    // ── Security group: SSH (22) and the app port (4000) restricted to the office
    // CIDR only — tighter than the manual EC2-DEPLOYMENT-GUIDE.md placeholder
    // (which opened 4000 to 0.0.0.0/0 pending infra-team lockdown).
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      securityGroupName: `monitor-suite-sg-${envName}`,
      vpc,
      description: `Monitoring Suite (${envName}) - SSH + app port, office IP only`,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(config.allowedCidr),
      ec2.Port.tcp(22),
      "SSH - admin access only"
    );
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(config.allowedCidr),
      ec2.Port.tcp(config.appPort),
      "App traffic - office IP only"
    );
    // Port 80: the Elastic Beanstalk nginx proxy listens here and forwards to the
    // app on appPort. We disable EB's default security group (which would open 80
    // to 0.0.0.0/0 — see DisableDefaultEC2SecurityGroup below), so this rule is
    // what lets the office reach the site at all. Office IP only.
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(config.allowedCidr),
      ec2.Port.tcp(80),
      "HTTP (nginx proxy) - office IP only"
    );

    // Pick EXACTLY ONE subnet for the whole environment, and put the persistent
    // volume in that same AZ. This is load-bearing: an EBS volume can only attach
    // to an instance in its OWN availability zone. If EB were free to launch
    // replacement instances across multiple AZs, a replacement in a different AZ
    // than the volume would fail to attach it (InvalidVolume.ZoneMismatch), the
    // mount would fail, and the app would come up with no database. Pinning the
    // environment to the volume's single AZ keeps single-instance + single-EBS
    // safe across instance replacement.
    //
    // We also skip excluded AZs (e.g. us-east-1e doesn't offer t3.small).
    const ebSubnet = vpc.publicSubnets.find(
      (s) => !config.excludeAzs.includes(s.availabilityZone)
    );
    if (!ebSubnet) {
      throw new Error(
        `No usable subnet for ${envName}: every public subnet is in an excluded AZ ` +
          `(${config.excludeAzs.join(", ")}). Check config.excludeAzs vs the VPC's AZs.`
      );
    }
    const ebSubnetIds = [ebSubnet.subnetId];
    const dataAz = ebSubnet.availabilityZone;

    // ── Persistent EBS volume for /app/data. This is the piece that makes Elastic
    // Beanstalk safe for a SQLite-backed app: EB instances are disposable and can be
    // replaced during a deploy or health-triggered replacement, which would silently
    // wipe a database living on the instance's own root volume. Mounting a separate,
    // named volume at /app/data (via the predeploy hook) means the database, and any
    // local-disk fallback uploads/reports, survive that replacement.
    // The volume is created in dataAz — the SAME AZ as the single EB subnet above.
    const dataVolume = new ec2.Volume(this, "DataVolume", {
      availabilityZone: dataAz,
      size: cdk.Size.gibibytes(config.ebsVolumeSizeGb),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    cdk.Tags.of(dataVolume).add("Name", `monitor-suite-data-${envName}`);

    // NOTE: automated EBS snapshots (AWS Data Lifecycle Manager) were designed and
    // coded here but deferred — the shared CDK CloudFormation execution role lacks
    // dlm:CreateLifecyclePolicy, and we chose not to modify that shared role. The
    // volume still survives instance replacement; it just isn't snapshot-backed yet.
    // To enable later: grant the CDK exec role dlm perms (or create the policy in
    // the AWS console), then re-add a dlm.CfnLifecyclePolicy targeting this volume.

    // The instance role needs permission to attach this specific volume to itself
    // (the .platform predeploy hook calls `aws ec2 attach-volume` at boot).
    // AttachVolume supports resource-level scoping, so we lock it to this volume
    // and any instance in the account.
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AttachDataVolume",
        effect: iam.Effect.ALLOW,
        actions: ["ec2:AttachVolume"],
        resources: [
          `arn:aws:ec2:${this.region}:${this.account}:volume/${dataVolume.volumeId}`,
          `arn:aws:ec2:${this.region}:${this.account}:instance/*`,
        ],
      })
    );
    // ec2:DescribeVolumes is a list/describe action that does NOT support
    // resource-level permissions — it must be granted on "*", or AWS treats a
    // scoped ARN as matching nothing and denies it (UnauthorizedOperation). The
    // hook calls describe-volumes to check the volume's state before attaching.
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DescribeVolumes",
        effect: iam.Effect.ALLOW,
        actions: ["ec2:DescribeVolumes"],
        resources: ["*"],
      })
    );

    // ── Elastic Beanstalk application + single-instance environment.
    // Single-instance (not load-balanced): the app writes SQLite directly to local
    // disk with no external DB — running more than one instance would mean multiple
    // processes writing the same file, which node:sqlite does not support safely.
    const application = new elasticbeanstalk.CfnApplication(this, "Application", {
      applicationName: `monitor-suite-${envName}`,
      description: "AI-Powered Functional Monitoring Suite - single-server Node app.",
    });

    const environment = new elasticbeanstalk.CfnEnvironment(this, "Environment", {
      environmentName: `monitor-suite-env-${envName}`,
      applicationName: application.applicationName!,
      platformArn: config.ebPlatformArn,
      optionSettings: [
        {
          namespace: "aws:autoscaling:launchconfiguration",
          optionName: "InstanceType",
          value: config.instanceType,
        },
        {
          namespace: "aws:autoscaling:launchconfiguration",
          optionName: "IamInstanceProfile",
          value: instanceProfile.instanceProfileName!,
        },
        {
          namespace: "aws:autoscaling:launchconfiguration",
          optionName: "SecurityGroups",
          value: securityGroup.securityGroupId,
        },
        // Do NOT let EB create its own default security group, which opens port 80
        // to 0.0.0.0/0 (the whole internet). With this true, the instance uses ONLY
        // our office-IP-locked security group above — making the environment
        // reachable only from the office CIDR, as required.
        {
          namespace: "aws:autoscaling:launchconfiguration",
          optionName: "DisableDefaultEC2SecurityGroup",
          value: "true",
        },
        // Tell EB explicitly which VPC and subnet to launch the instance in. Without
        // this, EB does not know our security group's network context and rejects it
        // with "security group does not exist". Single-instance envs launch directly
        // into a subnet (no load balancer), so a public subnet is required for the
        // instance to get a public IP reachable at the office CIDR.
        {
          namespace: "aws:ec2:vpc",
          optionName: "VPCId",
          value: vpc.vpcId,
        },
        {
          namespace: "aws:ec2:vpc",
          optionName: "Subnets",
          value: ebSubnetIds.join(","),
        },
        {
          namespace: "aws:ec2:vpc",
          optionName: "AssociatePublicIpAddress",
          value: "true",
        },
        {
          namespace: "aws:elasticbeanstalk:environment",
          optionName: "EnvironmentType",
          value: "SingleInstance",
        },
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "AWS_REGION",
          value: config.region,
        },
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "S3_BUCKET_NAME",
          value: uploadsBucket.bucketName,
        },
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "PROJECT_KEYS_SECRET_ARN",
          value: projectKeysSecret.secretArn,
        },
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "BACKEND_HOST",
          value: "0.0.0.0",
        },
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "PORT",
          value: String(config.appPort),
        },
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "DATA_VOLUME_ID",
          value: dataVolume.volumeId,
        },
        // SES_FROM_EMAIL is intentionally NOT set here — it's a per-sender-identity
        // value that must be verified in SES first (see backend/.env.example STEP 2).
        // Set it manually in the EB console once the identity is verified for this env.
      ],
    });
    environment.addDependency(instanceProfile);
    // The SecurityGroups option references the SG by ID as a raw string, which
    // CloudFormation does not treat as an implicit dependency. Make it explicit so
    // the environment waits for the SG to exist (and, on rollback, is torn down
    // before the SG is deleted — the race that caused an earlier deploy failure).
    environment.addDependency(
      securityGroup.node.defaultChild as ec2.CfnSecurityGroup
    );

    // ── Outputs — the values you'd otherwise have to copy by hand from 4 different
    // console screens.
    new cdk.CfnOutput(this, "EnvironmentUrl", {
      value: environment.attrEndpointUrl,
      description: "Elastic Beanstalk environment URL",
    });
    new cdk.CfnOutput(this, "UploadsBucketName", { value: uploadsBucket.bucketName });
    new cdk.CfnOutput(this, "ProjectKeysSecretArn", { value: projectKeysSecret.secretArn });
    new cdk.CfnOutput(this, "DataVolumeId", { value: dataVolume.volumeId });
    new cdk.CfnOutput(this, "SecurityGroupId", { value: securityGroup.securityGroupId });
  }
}
