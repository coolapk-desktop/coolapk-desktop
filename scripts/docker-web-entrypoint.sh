#!/bin/sh
set -eu

export COOLAPK_WEB_BIND="${COOLAPK_WEB_BIND:-0.0.0.0:${PORT:-8080}}"

# Docker may create a missing bind mount directory as root.
if [ "$(id -u)" = 0 ]; then
    mkdir -p -- "$COOLAPK_WEB_DATA_DIR"
    chown coolapk:coolapk -- "$COOLAPK_WEB_DATA_DIR"
    chmod 0700 -- "$COOLAPK_WEB_DATA_DIR"
    exec setpriv --reuid=coolapk --regid=coolapk --clear-groups --no-new-privs -- "$@"
fi

exec "$@"
