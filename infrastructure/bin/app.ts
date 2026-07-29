#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MonitorSuiteVpcStack } from "../lib/monitor-suite-vpc-stack";
import { ENVS } from "../lib/config";

const app = new cdk.App();

// Private-VPC (internal HTTPS) variant — a SEPARATE, brand-new environment
// deployed into the DevOps-provided private VPC that HAS a route into the corp
// network (so the app can reach the PRIVATE dev CMS). Only defined for envs that
// have a provided VPC configured (useProvidedVpc). Deploy dev only:
//   cdk deploy MonitorSuite-dev-vpc
for (const config of Object.values(ENVS)) {
  if (!config.useProvidedVpc) continue;
  new MonitorSuiteVpcStack(app, `MonitorSuite-${config.envName}-vpc`, {
    config,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: config.region,
    },
  });
}
