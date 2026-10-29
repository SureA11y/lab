#!/bin/sh
# `server` starts the app and its HTTP API; anything else is the runner's
# command line (node src/cli/run-workflow.js), run in /work.
set -e

if [ "$1" = "server" ]; then
    shift
    cd /lab
    # Inside a container the server has to listen beyond its own loopback to
    # be reached through a published port.
    export HOST="${HOST:-0.0.0.0}"
    export PORT="${PORT:-3000}"
    exec node server.js "$@"
fi

exec node /lab/src/cli/run-workflow.js "$@"
