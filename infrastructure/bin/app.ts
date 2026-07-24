#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MonitorSuiteStack } from "../lib/monitor-suite-stack";
import { MonitorSuiteLbStack } from "../lib/monitor-suite-lb-stack";
import { MonitorSuiteVpcStack } from "../lib/monitor-suite-vpc-stack";
import { ENVS } from "../lib/config";

const app = new cdk.App();

// All three environments are defined and synthesizable every time. Only `dev`
// is ever meant to be deployed today — `cdk deploy MonitorSuite-staging` or
// `-prod` will create real, billable resources and must not be run without
// sign-off (see infrastructure/README.md).
for (const config of Object.values(ENVS)) {
  new MonitorSuiteStack(app, `MonitorSuite-${config.envName}`, {
    config,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: config.region,
    },
  });
}

// Load-balanced (HTTPS) variant — a SEPARATE, brand-new environment created as
// load-balanced from the start (EB won't convert an existing single-instance env).
// It stands alongside the single-instance stacks above and never touches them.
// Deploy dev only: `cdk deploy MonitorSuite-dev-lb`.
for (const config of Object.values(ENVS)) {
  new MonitorSuiteLbStack(app, `MonitorSuite-${config.envName}-lb`, {
    config,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: config.region,
    },
  });
}

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
