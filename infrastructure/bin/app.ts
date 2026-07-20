#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MonitorSuiteStack } from "../lib/monitor-suite-stack";
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
