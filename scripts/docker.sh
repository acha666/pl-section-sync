#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker build -t pl-section-sync-dev .devcontainer
if [ "$*" = "npm run dev" ]; then
  set -- -p 127.0.0.1:8080:8080 pl-section-sync-dev "$@"
else
  set -- pl-section-sync-dev "$@"
fi
exec docker run --rm --init --user "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/npm-cache \
  --mount "type=bind,source=$(pwd),target=/workspace" "$@"
