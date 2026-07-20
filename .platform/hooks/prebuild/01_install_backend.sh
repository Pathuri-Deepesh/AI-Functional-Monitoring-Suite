#!/bin/bash
# .platform/hooks/prebuild/01_install_backend.sh
#
# Installs the backend's dependencies (including devDependencies) on the EB
# instance. This is required because:
#   - The app runs TypeScript directly via `tsx` (a devDependency), so tsx and
#     typescript MUST be present at runtime.
#   - The root package.json has no dependencies of its own, so Elastic
#     Beanstalk's automatic `npm install` at the bundle root installs nothing
#     useful for the backend. We install backend deps explicitly here.
#
# AL2023 platform hook: runs as root, cwd is the staging directory (the app
# root), before the app/proxy are configured and before the app starts.
set -euo pipefail

echo "[prebuild] installing backend dependencies (including dev)"
npm --prefix backend install --include=dev
echo "[prebuild] backend dependencies installed"
