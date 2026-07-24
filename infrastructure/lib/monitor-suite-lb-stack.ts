import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elasticbeanstalk from "aws-cdk-lib/aws-elasticbeanstalk";
import type { EnvConfig } from "./config";

export interface MonitorSuiteLbStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * LOAD-BALANCED + HTTPS variant of the Monitoring Suite environment.
 *
 * WHY A SEPARATE STACK/ENV: Elastic Beanstalk forbids converting an existing
 * environment's type (SingleInstance -> LoadBalanced) in place — the API rejects
 * it with "LoadBalancer type option cannot be changed." So HTTPS (which needs an
 * ALB, which needs a load-balanced env) requires a BRAND-NEW environment created
 * as load-balanced from the start. This stack is exactly that.
 *
 * It stands ALONGSIDE the original single-instance MonitorSuiteStack — that one is
 * never touched. This env uses its own names (suffix `-dev-lb`), its own fresh
 * (empty) EBS data volume, and its own security groups, but REUSES the existing
 * per-env S3 bucket and Secrets Manager secret by reference (so already-stored
 * API keys carry over). Data in SQLite starts fresh (Path 1).
 *
 * Everything else mirrors the proven single-instance design: single-AZ EBS pin
 * for the SQLite volume, IMDSv2 attach hook, postdeploy symlink — plus MinSize=
 * MaxSize=1 so the load-balanced env still runs exactly one instance (SQLite is
 * a single-writer store).
 */
export class MonitorSuiteLbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitorSuiteLbStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { envName } = config;
    // Distinct suffix for every NEW resource this stack creates, so nothing
    // collides with the original single-instance stack's `-dev` resources.
    const lbName = `${envName}-lb`;

    // ── Network: reuse the account's default VPC (same as the original stack).
    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });

    // ── REUSE the existing per-env S3 bucket and Secrets Manager secret created
    // by the original stack — reference them by name, do NOT create new ones
    // (creating would collide with "already exists"). This is what carries the
    // already-stored API keys and uploads over to the new env.
    const uploadsBucket = s3.Bucket.fromBucketName(
      this,
      "UploadsBucket",
      `monitor-suite-storage-${envName}`
    );
    const projectKeysSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ProjectKeysSecret",
      `/monitor-suite/${envName}/project-api-keys`
    );

    // ── IAM role for the EB EC2 instance — same scoped permissions as the
    // original: S3 read/write, secret read+write, SES send, plus volume attach.
    const instanceRole = new iam.Role(this, "InstanceRole", {
      roleName: `monitor-suite-instance-role-${lbName}`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
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
        resources: ["*"],
      })
    );

    const instanceProfile = new iam.CfnInstanceProfile(this, "InstanceProfile", {
      instanceProfileName: `monitor-suite-instance-profile-${lbName}`,
      roles: [instanceRole.roleName],
    });

    // ── Load balancer security group (public side): HTTPS:443 from office only.
    const lbSecurityGroup = new ec2.SecurityGroup(this, "LbSecurityGroup", {
      securityGroupName: `monitor-suite-lb-sg-${lbName}`,
      vpc,
      description: `Monitoring Suite (${lbName}) - ALB, HTTPS from office IP only`,
      allowAllOutbound: true,
    });
    lbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(config.allowedCidr),
      ec2.Port.tcp(443),
      "HTTPS - office IP only"
    );

    // ── Instance security group: SSH from office; app port from the ALB SG only.
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      securityGroupName: `monitor-suite-sg-${lbName}`,
      vpc,
      description: `Monitoring Suite (${lbName}) - SSH (office) + app port (from ALB)`,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4(config.allowedCidr),
      ec2.Port.tcp(22),
      "SSH - admin access only"
    );
    securityGroup.addIngressRule(
      ec2.Peer.securityGroupId(lbSecurityGroup.securityGroupId),
      ec2.Port.tcp(config.appPort),
      "App traffic - from ALB only"
    );

    // ── Single-AZ pin for the SQLite EBS volume (same rationale as the original
    // stack: an EBS volume attaches only within its own AZ). The INSTANCE lives
    // in this one subnet; the ALB spans multiple AZs below.
    const ebSubnet = vpc.publicSubnets.find(
      (s) => !config.excludeAzs.includes(s.availabilityZone)
    );
    if (!ebSubnet) {
      throw new Error(
        `No usable subnet for ${lbName}: every public subnet is in an excluded AZ ` +
          `(${config.excludeAzs.join(", ")}).`
      );
    }
    const ebSubnetIds = [ebSubnet.subnetId];
    const dataAz = ebSubnet.availabilityZone;

    // ── ALB subnets: >=2 AZs required. Separate from the instance's single subnet.
    const elbSubnets = vpc.publicSubnets.filter(
      (s) => !config.excludeAzs.includes(s.availabilityZone)
    );
    if (elbSubnets.length < 2) {
      throw new Error(
        `An ALB needs subnets in >=2 AZs, but only ${elbSubnets.length} usable ` +
          `public subnet(s) were found (excluded AZs: ${config.excludeAzs.join(", ")}).`
      );
    }
    const elbSubnetIds = elbSubnets.map((s) => s.subnetId);

    // ── Guard: HTTPS requires a real ACM cert ARN (us-east-1).
    if (!config.lbCertificateArn) {
      throw new Error(
        `config.lbCertificateArn is empty for "${envName}". Set the ACM certificate ` +
          `ARN (us-east-1) in infrastructure/lib/config.ts before deploying.`
      );
    }

    // ── Fresh, EMPTY persistent EBS volume for /app/data (Path 1: new DB). RETAIN
    // so it survives instance replacement and stack teardown.
    const dataVolume = new ec2.Volume(this, "DataVolume", {
      availabilityZone: dataAz,
      size: cdk.Size.gibibytes(config.ebsVolumeSizeGb),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    cdk.Tags.of(dataVolume).add("Name", `monitor-suite-data-${lbName}`);

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
    instanceRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DescribeVolumes",
        effect: iam.Effect.ALLOW,
        actions: ["ec2:DescribeVolumes"],
        resources: ["*"],
      })
    );

    // ── EB application + LOAD-BALANCED environment (created load-balanced from
    // the start — the only way AWS permits it).
    const application = new elasticbeanstalk.CfnApplication(this, "Application", {
      applicationName: `monitor-suite-${lbName}`,
      description:
        "AI-Powered Functional Monitoring Suite - load-balanced (HTTPS) env.",
    });

    const environment = new elasticbeanstalk.CfnEnvironment(this, "Environment", {
      environmentName: `monitor-suite-env-${lbName}`,
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
        // Pin to exactly ONE instance — SQLite is single-writer.
        { namespace: "aws:autoscaling:asg", optionName: "MinSize", value: "1" },
        { namespace: "aws:autoscaling:asg", optionName: "MaxSize", value: "1" },
        // Do NOT let EB open its own default SG (would expose port 80 to the world).
        {
          namespace: "aws:autoscaling:launchconfiguration",
          optionName: "DisableDefaultEC2SecurityGroup",
          value: "true",
        },
        // VPC + instance subnet (single AZ, volume's AZ).
        { namespace: "aws:ec2:vpc", optionName: "VPCId", value: vpc.vpcId },
        {
          namespace: "aws:ec2:vpc",
          optionName: "Subnets",
          value: ebSubnetIds.join(","),
        },
        // ALB subnets (multi-AZ) + scheme.
        {
          namespace: "aws:ec2:vpc",
          optionName: "ELBSubnets",
          value: elbSubnetIds.join(","),
        },
        {
          namespace: "aws:ec2:vpc",
          optionName: "ELBScheme",
          value: config.elbScheme,
        },
        {
          namespace: "aws:ec2:vpc",
          optionName: "AssociatePublicIpAddress",
          value: "true",
        },
        // Load-balanced application ALB.
        {
          namespace: "aws:elasticbeanstalk:environment",
          optionName: "EnvironmentType",
          value: "LoadBalanced",
        },
        {
          namespace: "aws:elasticbeanstalk:environment",
          optionName: "LoadBalancerType",
          value: "application",
        },
        // Default (:80) listener off — HTTPS only.
        {
          namespace: "aws:elbv2:listener:default",
          optionName: "ListenerEnabled",
          value: "false",
        },
        // HTTPS:443 listener with the ACM cert.
        {
          namespace: "aws:elbv2:listener:443",
          optionName: "ListenerEnabled",
          value: "true",
        },
        {
          namespace: "aws:elbv2:listener:443",
          optionName: "Protocol",
          value: "HTTPS",
        },
        {
          namespace: "aws:elbv2:listener:443",
          optionName: "SSLCertificateArns",
          value: config.lbCertificateArn,
        },
        {
          namespace: "aws:elbv2:listener:443",
          optionName: "SSLPolicy",
          value: "ELBSecurityPolicy-TLS-1-2-Ext-2018-06",
        },
        // ALB security group (office-locked).
        {
          namespace: "aws:elbv2:loadbalancer",
          optionName: "ManagedSecurityGroup",
          value: lbSecurityGroup.securityGroupId,
        },
        {
          namespace: "aws:elbv2:loadbalancer",
          optionName: "SecurityGroups",
          value: lbSecurityGroup.securityGroupId,
        },
        // Health check → /api/health on the app port.
        {
          namespace: "aws:elasticbeanstalk:environment:process:default",
          optionName: "Port",
          value: String(config.appPort),
        },
        {
          namespace: "aws:elasticbeanstalk:environment:process:default",
          optionName: "Protocol",
          value: "HTTP",
        },
        {
          namespace: "aws:elasticbeanstalk:environment:process:default",
          optionName: "HealthCheckPath",
          value: "/api/health",
        },
        // App environment variables — same as the original env.
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "AWS_REGION",
          value: config.region,
        },
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "S3_BUCKET_NAME",
          value: `monitor-suite-storage-${envName}`,
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
      ],
    });
    environment.addDependency(instanceProfile);
    environment.addDependency(
      securityGroup.node.defaultChild as ec2.CfnSecurityGroup
    );
    environment.addDependency(
      lbSecurityGroup.node.defaultChild as ec2.CfnSecurityGroup
    );

    // ── Outputs.
    new cdk.CfnOutput(this, "EnvironmentUrl", {
      value: environment.attrEndpointUrl,
      description:
        "Load balancer DNS name for the HTTPS env. Give this to infra to point " +
        "monitor-cloudservices.np.logitech.io at (CNAME).",
    });
    new cdk.CfnOutput(this, "DataVolumeId", { value: dataVolume.volumeId });
    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: securityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, "LbSecurityGroupId", {
      value: lbSecurityGroup.securityGroupId,
    });
  }
}
