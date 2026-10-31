#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ui-cloudflare-common.sh
source "$SCRIPT_DIR/ui-cloudflare-common.sh"
ui_parse_args build "$@"

[[ -n "${NPM_TOKEN:-}" ]] || ui_fail "Export NPM_TOKEN with access to the private GitHub packages before building"
export NPM_TOKEN
command -v docker >/dev/null || ui_fail "Docker with Buildx is required"

if [[ "$UI_STATIC_BUILD_STAGE" == builder-local-packages ]]; then
    for package in editor glideboard glideline canvas-text-editor; do
        [[ -d "$UI_ROOT_DIR/packages/$package/dist" ]] || ui_fail "Build packages/$package/dist before using local packages"
    done
fi

mkdir -p "$UI_ROOT_DIR/output"
UI_TEMP_OUTPUT="$(mktemp -d "$UI_ROOT_DIR/output/.ui-cloudflare.XXXXXX")"
trap 'rm -rf "$UI_TEMP_OUTPUT"' EXIT
UI_BUILD_REVISION="$(git -C "$UI_ROOT_DIR" rev-parse HEAD 2>/dev/null || printf unknown)"

docker buildx build \
    --file "$UI_ROOT_DIR/docker/deploy/ui.Dockerfile" \
    --target static-artifact \
    --secret id=npm_token,env=NPM_TOKEN \
    --build-arg "UI_STATIC_BUILD_STAGE=$UI_STATIC_BUILD_STAGE" \
    --build-arg "UI_BUILD_REVISION=$UI_BUILD_REVISION" \
    "${UI_BUILD_ARGS[@]}" \
    --output "type=local,dest=$UI_TEMP_OUTPUT" \
    "$UI_ROOT_DIR"

# Replace only generated artifacts, and only after build-time validation passes.
mkdir -p "$UI_STATIC_OUTPUT_DIR"
rm -rf "$UI_STATIC_OUTPUT_DIR/dist"
mv "$UI_TEMP_OUTPUT/dist" "$UI_STATIC_OUTPUT_DIR/dist"
mv "$UI_TEMP_OUTPUT/build-info.json" "$UI_STATIC_OUTPUT_DIR/build-info.json"
echo "Built UI static release: $UI_STATIC_OUTPUT_DIR"
