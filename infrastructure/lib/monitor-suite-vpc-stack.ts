import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elasticbeanstalk from "aws-cdk-lib/aws-elasticbeanstalk";
import type { EnvConfig } from "./config";

export interface MonitorSuiteVpcStackProps extends cdk.StackProps {
  config: EnvConfig;
}

/**
 * PRIVATE-VPC + LOAD-BALANCED (internal HTTPS) variant of the Monitoring Suite.
 *
 * WHY THIS STACK EXISTS: the original `-lb` env runs in the account's DEFAULT VPC.
 * That VPC has no route into Logitech's private `np.logitech.io` network, so the
 * app can reach the (public) PROD CMS but times out on the (private) DEV CMS
 * (dev-campaign-service-cms.np.logitech.io). DevOps handed over a private VPC
 * (config.providedVpcId) whose route table already has a NAT gateway and a
 * 172.16.0.0/12 route toward the corp network — i.e. it CAN reach the private
 * CMS. This stack deploys a brand-new EB environment INTO that VPC.
 *
 * WHY A NEW ENV (not a redeploy of `-lb`): Elastic Beanstalk does not allow
 * changing an existing environment's VPC/subnets in place. So, exactly like the
 * single-instance -> load-balanced switch before it, moving into a new VPC means
 * creating a fresh environment. This one uses the suffix `-vpc` for every new
 * resource, stands ALONGSIDE the `-lb` env (left untouched as a fallback), and
 * REUSES the existing per-env S3 bucket + Secrets Manager secret by reference so
 * stored API keys carry over. SQLite data starts fresh on a new EBS volume.
 *
 * KEY DIFFERENCE vs `-lb`: all provided subnets are PRIVATE (no public IP), so
 * the ALB is INTERNAL (reachable only from inside the corp network / VPN), and
 * the instance gets no public IP — its outbound to the CMS + AWS APIs goes
 * through the VPC's NAT gateway (DevOps owns the NAT/route/firewall side).
 */
export class MonitorSuiteVpcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitorSuiteVpcStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { envName } = config;
    // Distinct suffix so nothing collides with the `-dev` or `-dev-lb` resources.
    const vpcName = `${envName}-vpc`;

    // ── Guard: this stack is only meaningful with a provided VPC configured.
    if (!config.useProvidedVpc) {
      throw new Error(
        `MonitorSuiteVpcStack for "${envName}" requires config.useProvidedVpc=true ` +
          `and the provided VPC/subnet ids set in infrastructure/lib/config.ts.`
      );
    }
    if (
      !config.providedVpcId ||
      !config.providedInstanceSubnetId ||
      config.providedElbSubnetIds.length < 2
    ) {
      throw new Error(
        `MonitorSuiteVpcStack for "${envName}": providedVpcId, ` +
          `providedInstanceSubnetId, and >=2 providedElbSubnetIds must all be set.`
      );
    }
    if (!config.lbCertificateArn) {
      throw new Error(
        `config.lbCertificateArn is empty for "${envName}". Set the ACM certificate ` +
          `ARN (us-east-1) in infrastructure/lib/config.ts before deploying.`
      );
    }

    // ── Network: the DevOps-provided private VPC. Referenced by id (no lookup of
    // subnets needed — we were handed explicit subnet ids).
    const vpc = ec2.Vpc.fromVpcAttributes(this, "ProvidedVpc", {
      vpcId: config.providedVpcId,
      // AZs of the provided subnets. Only used to satisfy the CDK VPC model;
      // we always pass explicit subnet ids to EB, never let it pick.
      availabilityZones: cdk.Stack.of(this).availabilityZones,
    });

    // ── REUSE the existing per-env S3 bucket + Secrets Manager secret (carries
    // over stored API keys + uploads). Do NOT create new ones.
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

    // ── IAM role for the EB EC2 instance — same scoped permissions as the other
    // stacks: S3 read/write, secret read+write, SES send, plus volume attach.
    const instanceRole = new iam.Role(this, "InstanceRole", {
      roleName: `monitor-suite-instance-role-${vpcName}`,
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
      instanceProfileName: `monitor-suite-instance-profile-${vpcName}`,
      roles: [instanceRole.roleName],
    });

    // ── Load balancer security group (INTERNAL ALB): HTTPS:443 from inside the
    // VPC/corp network. allowAllOutbound so it can forward to the instance.
    const lbSecurityGroup = new ec2.SecurityGroup(this, "LbSecurityGroup", {
      securityGroupName: `monitor-suite-lb-sg-${vpcName}`,
      vpc,
      description: `Monitoring Suite (${vpcName}) - internal ALB, HTTPS from corp network`,
      allowAllOutbound: true,
    });
    // Internal ALB: accept HTTPS from the corp network. allowedCidr is the office
    // public IP, which is NOT how internal callers appear (they arrive with
    // private source IPs), so allow the corp/private ranges reaching this VPC.
    // 172.16.0.0/12 is the corp range routed into this VPC (per the route table);
    // the VPC's own CIDR covers same-VPC callers.
    lbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4("172.16.0.0/12"),
      ec2.Port.tcp(443),
      "HTTPS - corp/internal network"
    );
    lbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4("172.30.204.0/22"),
      ec2.Port.tcp(443),
      "HTTPS - same VPC"
    );

    // ── Instance security group: SSH from corp; app port from the ALB SG only.
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      securityGroupName: `monitor-suite-sg-${vpcName}`,
      vpc,
      description: `Monitoring Suite (${vpcName}) - SSH (corp) + app port (from ALB)`,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4("172.16.0.0/12"),
      ec2.Port.tcp(22),
      "SSH - corp network only"
    );
    securityGroup.addIngressRule(
      ec2.Peer.securityGroupId(lbSecurityGroup.securityGroupId),
      ec2.Port.tcp(config.appPort),
      "App traffic - from ALB only"
    );

    // ── Instance subnet (single AZ — the EBS data volume pins to this AZ).
    // The data volume's AZ MUST match the instance subnet's AZ. CDK can't read a
    // subnet's AZ from an id-only reference, so config carries it explicitly.
    const instanceSubnetIds = [config.providedInstanceSubnetId];
    const dataAz = config.providedInstanceSubnetAz;

    // ── ALB subnets: the provided list (>=2 AZs, validated above).
    const elbSubnetIds = config.providedElbSubnetIds;

    // ── Fresh, EMPTY persistent EBS volume for /app/data (new DB). RETAIN so it
    // survives instance replacement and stack teardown.
    const dataVolume = new ec2.Volume(this, "DataVolume", {
      availabilityZone: dataAz,
      size: cdk.Size.gibibytes(config.ebsVolumeSizeGb),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    cdk.Tags.of(dataVolume).add("Name", `monitor-suite-data-${vpcName}`);

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

    // ── EB application + LOAD-BALANCED environment in the provided private VPC.
    const application = new elasticbeanstalk.CfnApplication(this, "Application", {
      applicationName: `monitor-suite-${vpcName}`,
      description:
        "AI-Powered Functional Monitoring Suite - private-VPC internal HTTPS env.",
    });

    const environment = new elasticbeanstalk.CfnEnvironment(this, "Environment", {
      environmentName: `monitor-suite-env-${vpcName}`,
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
        // Do NOT let EB open its own default SG.
        {
          namespace: "aws:autoscaling:launchconfiguration",
          optionName: "DisableDefaultEC2SecurityGroup",
          value: "true",
        },
        // Provided VPC + instance subnet (single AZ, volume's AZ).
        { namespace: "aws:ec2:vpc", optionName: "VPCId", value: config.providedVpcId },
        {
          namespace: "aws:ec2:vpc",
          optionName: "Subnets",
          value: instanceSubnetIds.join(","),
        },
        // ALB subnets (>=2 AZs) + INTERNAL scheme.
        {
          namespace: "aws:ec2:vpc",
          optionName: "ELBSubnets",
          value: elbSubnetIds.join(","),
        },
        {
          namespace: "aws:ec2:vpc",
          optionName: "ELBScheme",
          value: "internal",
        },
        // Private subnets: instance gets NO public IP; outbound is via NAT.
        {
          namespace: "aws:ec2:vpc",
          optionName: "AssociatePublicIpAddress",
          value: "false",
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
        // ALB security group.
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
        // App environment variables — same as the other envs.
        {
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "AWS_REGION",
          value: config.region,
        },
        {
          // Sender ("From") address for SES failure/audit emails. Must be an
          // address (or domain) already VERIFIED in SES for this region. The
          // EC2 instance role already carries ses:SendEmail (granted above), so
          // no AWS keys are needed. Leave notification RECIPIENTS to the app UI
          // (per-project Settings → Notifications). If this is empty the app
          // simply reports "SES not configured" and sends nothing (no crash).
          namespace: "aws:elasticbeanstalk:application:environment",
          optionName: "SES_FROM_EMAIL",
          value: config.sesFromEmail ?? "",
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
    // NOTE: unlike an internet-facing env, an INTERNAL EB environment does not
    // expose the `EndpointURL` attribute — referencing it fails stack creation
    // ("Attribute 'EndpointURL' does not exist"). Get the internal ALB DNS name
    // from the EB Console / `eb status` instead. We output the env name here.
    new cdk.CfnOutput(this, "EnvironmentName", {
      value: `monitor-suite-env-${vpcName}`,
      description:
        "Internal (private-VPC) EB environment. Reachable only from inside the " +
        "corp network / VPN. Get the internal ALB DNS via the EC2 Load Balancers " +
        "console or `eb status`.",
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
