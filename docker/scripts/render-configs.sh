#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

parse_env_arg "$@"
load_env_file
render_all_templates

echo "Rendered deployment config into $GENERATED_DIR"
