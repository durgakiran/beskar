#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ui-cloudflare-common.sh
source "$SCRIPT_DIR/ui-cloudflare-common.sh"
ui_parse_args deploy "$@"

command -v node >/dev/null || ui_fail "Node.js 22 or newer is required to run Wrangler locally"
command -v npx >/dev/null || ui_fail "npm/npx is required to run Wrangler locally"
[[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || ui_fail "Set CLOUDFLARE_ACCOUNT_ID in the frontend env file or shell"
[[ "${CLOUDFLARE_WORKER_NAME:-}" =~ ^[a-z0-9][a-z0-9-]*$ ]] || ui_fail "Set CLOUDFLARE_WORKER_NAME to the dedicated Worker name (lowercase letters, digits, and hyphens)"
export CLOUDFLARE_ACCOUNT_ID
export WRANGLER_SEND_METRICS=false

# Use the saved local OAuth session even if an old token/key is still exported.
# These changes are scoped to this script and do not alter the caller's shell.
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
unset CF_API_TOKEN CF_API_KEY CF_EMAIL
UI_WRANGLER=(npx --yes "wrangler@$UI_WRANGLER_VERSION")
if ! "${UI_WRANGLER[@]}" whoami --json >/dev/null; then
    ui_fail "Unable to verify your Wrangler session. Run: npx --yes wrangler@$UI_WRANGLER_VERSION login"
fi

if [[ "$UI_SKIP_BUILD" != true ]]; then
    bash "$SCRIPT_DIR/build-ui-static.sh" --env "$UI_ENV_FILE"
fi
[[ -d "$UI_STATIC_OUTPUT_DIR/dist" && -f "$UI_STATIC_OUTPUT_DIR/build-info.json" ]] || ui_fail "No static release found; run build-ui-static.sh first or omit --skip-build"

node "$SCRIPT_DIR/verify-ui-static.mjs" "$UI_STATIC_OUTPUT_DIR/dist" \
    --check-manifest "$UI_STATIC_OUTPUT_DIR/build-info.json"

echo "Deploying static release to Cloudflare Worker: $CLOUDFLARE_WORKER_NAME"
"${UI_WRANGLER[@]}" deploy \
    --config "$UI_ROOT_DIR/docker/cloudflare/wrangler.jsonc" \
    --name "$CLOUDFLARE_WORKER_NAME"
