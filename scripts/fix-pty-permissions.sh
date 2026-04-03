#!/usr/bin/env bash
# fix-pty-permissions.sh
# ---------------------------------------------------------------------------
# Ensures node-pty's "spawn-helper" binary has execute permission on every
# platform.  On macOS (especially Apple Silicon) npm can strip the +x bit
# when extracting prebuilt binaries, which causes:
#
#   Error: posix_spawnp failed.
#
# This script is safe to run on any OS — it silently skips platforms that
# don't need fixing (Windows) or where nothing is wrong.
# ---------------------------------------------------------------------------

set -euo pipefail

PREBUILDS_DIR="node_modules/node-pty/prebuilds"

# If node-pty isn't installed (yet), nothing to do.
if [ ! -d "$PREBUILDS_DIR" ]; then
  exit 0
fi

OS="$(uname -s)"
ARCH="$(uname -m)"
FIXED=0

# Map uname values to node-pty's prebuild directory names
case "$OS" in
  Darwin) PLATFORM_PREFIX="darwin" ;;
  Linux)  PLATFORM_PREFIX="linux"  ;;
  *)
    # Windows / other — spawn-helper isn't used; nothing to fix.
    exit 0
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_SUFFIX="arm64" ;;
  x86_64|amd64)  ARCH_SUFFIX="x64"   ;;
  *)             ARCH_SUFFIX="$ARCH"  ;;
esac

# Fix ALL spawn-helper binaries (not just the current platform) so the repo
# works if node_modules are shared across different machines (e.g. Docker
# volume mounts, CI caches, NFS).
for helper in "$PREBUILDS_DIR"/*/spawn-helper; do
  [ -f "$helper" ] || continue

  if [ ! -x "$helper" ]; then
    chmod +x "$helper"
    FIXED=$((FIXED + 1))
    echo "[fix-pty] chmod +x $helper"
  fi
done

# Also fix the pty.node binaries — some environments strip those too.
for ptynode in "$PREBUILDS_DIR"/*/pty.node; do
  [ -f "$ptynode" ] || continue

  if [ ! -x "$ptynode" ]; then
    chmod +x "$ptynode"
    FIXED=$((FIXED + 1))
    echo "[fix-pty] chmod +x $ptynode"
  fi
done

if [ "$FIXED" -gt 0 ]; then
  echo "[fix-pty] Fixed $FIXED file(s). node-pty should now work correctly."
else
  echo "[fix-pty] All node-pty binaries already have correct permissions."
fi

exit 0
