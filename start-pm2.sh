#!/bin/bash
# Host entrypoint — same as `npm run pm2:start`.
# Pulls latest, builds/installs the IDE container, and starts it.
# Never deletes images or volumes.
exec node scripts/pm2-host.cjs start "$@"
