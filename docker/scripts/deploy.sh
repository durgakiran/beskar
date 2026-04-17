#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

parse_env_arg "$@"
load_env_file
render_all_templates

docker_compose config >/dev/null

docker_compose up -d postgres redis
docker_compose run --rm --build db-init
docker_compose up -d --build guard zitadel server signalserver ui launchsite proxy

echo "Deployment finished for project $COMPOSE_PROJECT_NAME"
