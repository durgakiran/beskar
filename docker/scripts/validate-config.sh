#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

parse_env_arg "$@"
load_env_file
render_all_templates

docker_compose config >/dev/null

echo "Validated deployment config for $ENV_FILE"
