#!/bin/bash
# .platform/hooks/predeploy/01_mount_data_volume.sh
#
# Attaches the CDK-created persistent EBS volume (passed in via the
# DATA_VOLUME_ID environment property), mounts it at /app/data, and symlinks
# /var/app/current/data -> /app/data so the app's cwd-relative ./data/* paths
# (db.sqlite + WAL/SHM, reports/, uploads/) land on the persistent volume and
# survive deploys and instance replacement.
#
# Runs on the AL2023 platform as root, after the source bundle is staged and
# before the app starts (predeploy stage). IMDSv2 (token) is mandatory on
# AL2023 — bare IMDSv1 metadata calls return nothing.
set -euo pipefail

MOUNT_POINT="/app/data"

if [ -z "${DATA_VOLUME_ID:-}" ]; then
  echo "[mount] DATA_VOLUME_ID not set — skipping volume mount; data will NOT persist." >&2
  exit 0
fi

# --- IMDSv2 session token (required on AL2023) ---
TOKEN="$(curl -sX PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")"
imds() {
  curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
    "http://169.254.169.254/latest/meta-data/$1"
}

REGION="$(imds placement/region)"
INSTANCE_ID="$(imds instance-id)"
echo "[mount] region=$REGION instance=$INSTANCE_ID volume=$DATA_VOLUME_ID"

# --- Attach only if the volume is currently available ---
STATE="$(aws ec2 describe-volumes --region "$REGION" --volume-ids "$DATA_VOLUME_ID" \
  --query 'Volumes[0].State' --output text)"
echo "[mount] volume state: $STATE"

if [ "$STATE" = "available" ]; then
  # Request /dev/sdf; Nitro instances remap this (resolved below).
  aws ec2 attach-volume --region "$REGION" --volume-id "$DATA_VOLUME_ID" \
    --instance-id "$INSTANCE_ID" --device /dev/sdf
  aws ec2 wait volume-in-use --region "$REGION" --volume-ids "$DATA_VOLUME_ID"
elif [ "$STATE" != "in-use" ]; then
  echo "[mount] volume not attachable (state=$STATE) — aborting." >&2
  exit 1
fi

# --- Robust device discovery (Nitro/AL2023) ---
# The requested /dev/sdf appears as /dev/xvdf on Xen, or as an NVMe device
# (/dev/nvme?n1, unpredictable index) on Nitro. Resolve by matching the EBS
# volume-id in the NVMe controller serial, with sd/xvd fallbacks.
find_device() {
  local vid_nodash
  vid_nodash="$(echo "$DATA_VOLUME_ID" | tr -d '-')"
  if command -v nvme >/dev/null 2>&1; then
    for dev in /dev/nvme*n1; do
      [ -e "$dev" ] || continue
      if nvme id-ctrl "$dev" 2>/dev/null | grep -qi "$vid_nodash"; then
        echo "$dev"; return 0
      fi
    done
  fi
  for d in /dev/sdf /dev/xvdf; do
    [ -e "$d" ] && { echo "$d"; return 0; }
  done
  return 1
}

DEVICE=""
for _ in $(seq 1 30); do
  if DEVICE="$(find_device)"; then break; fi
  sleep 2
done
if [ -z "$DEVICE" ]; then
  echo "[mount] could not locate attached device for $DATA_VOLUME_ID" >&2
  lsblk >&2 || true
  exit 1
fi
echo "[mount] resolved device: $DEVICE"

# --- Format only if the volume has no filesystem yet (fresh volume) ---
if ! blkid "$DEVICE" >/dev/null 2>&1; then
  echo "[mount] no filesystem on $DEVICE — creating ext4"
  mkfs -t ext4 "$DEVICE"
fi

mkdir -p "$MOUNT_POINT"
if ! mountpoint -q "$MOUNT_POINT"; then
  mount "$DEVICE" "$MOUNT_POINT"
  echo "[mount] mounted $DEVICE at $MOUNT_POINT"
fi

# --- App subdirectories the code expects under ./data ---
mkdir -p "$MOUNT_POINT/reports" "$MOUNT_POINT/uploads"

# --- Ownership: the AL2023 Node platform runs the app as 'webapp' ---
if id webapp >/dev/null 2>&1; then
  chown -R webapp:webapp "$MOUNT_POINT"
fi

# NOTE: the symlink from the app's data dir to $MOUNT_POINT is NOT created here.
# predeploy runs against /var/app/staging, which is then renamed to
# /var/app/current AFTER this hook — so any symlink created under current would
# be replaced by the rename. The relink is done in a postdeploy hook instead
# (.platform/hooks/postdeploy/01_relink_data.sh), which runs after the app is in
# its final location.
echo "[mount] done (mount ready at $MOUNT_POINT; relink handled in postdeploy)"
