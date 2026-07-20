#!/bin/bash
# .platform/hooks/postdeploy/01_relink_data.sh
#
# Redirects the app's data directory onto the persistent EBS volume mounted at
# /app/data (mounted earlier by the predeploy hook).
#
# WHY postdeploy (not predeploy): predeploy runs against /var/app/staging, which
# is then renamed to /var/app/current — so a symlink created in predeploy is
# wiped by that rename. postdeploy runs after the app is in its final location
# (/var/app/current) and after it has started, so the symlink sticks. We restart
# the app once at the end so it reopens the SQLite DB through the symlink.
#
# The app's cwd is /var/app/current/backend (Procfile: `npm --prefix backend
# start`), so its relative ./data resolves to APP_DATA below.
set -euo pipefail

MOUNT_POINT="/app/data"
APP_DATA="/var/app/current/backend/data"

# If the mount isn't present, do nothing rather than silently writing to the
# ephemeral disk — makes a mount problem visible instead of losing data quietly.
if ! mountpoint -q "$MOUNT_POINT"; then
  echo "[relink] $MOUNT_POINT is not a mountpoint — aborting relink." >&2
  exit 1
fi

# If APP_DATA is already the symlink we want, nothing to do.
if [ -L "$APP_DATA" ] && [ "$(readlink -f "$APP_DATA")" = "$MOUNT_POINT" ]; then
  echo "[relink] $APP_DATA already -> $MOUNT_POINT; nothing to do."
  exit 0
fi

# APP_DATA is a real directory the app just created on the ephemeral disk. On the
# very first deploy it may hold a freshly-initialised db.sqlite; migrate anything
# that isn't already on the volume, without overwriting existing persistent data.
if [ -d "$APP_DATA" ] && [ ! -L "$APP_DATA" ]; then
  echo "[relink] migrating any fresh data from $APP_DATA into $MOUNT_POINT (no overwrite)"
  cp -an "$APP_DATA/." "$MOUNT_POINT/" 2>/dev/null || true
  rm -rf "$APP_DATA"
fi

ln -sfn "$MOUNT_POINT" "$APP_DATA"
echo "[relink] symlinked $APP_DATA -> $MOUNT_POINT"

if id webapp >/dev/null 2>&1; then
  chown -h webapp:webapp "$APP_DATA" || true
  chown -R webapp:webapp "$MOUNT_POINT" || true
fi

# Restart the app so it reopens the SQLite DB through the corrected path.
echo "[relink] restarting web service"
systemctl restart web.service
echo "[relink] done"
