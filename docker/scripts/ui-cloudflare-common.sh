#!/usr/bin/env bash

# Shared only by the local UI static build/deploy scripts. Do not load common.sh:
# it requires backend credentials and renders the complete Compose deployment.
UI_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UI_STATIC_OUTPUT_DIR="$UI_ROOT_DIR/output/ui-cloudflare"
UI_WRANGLER_VERSION=4.155.0
UI_PUBLIC_VARIABLES=(
    USER_SERVER_URL API_URL API_BASE_URL IMAGE_SERVER_URL SIGNALING_URL
    HASURA_PROJECT_ENDPOINT PAGE_EVENTS_SSE PAGE_EVENTS_TRANSPORT_LOG EDITOR_PRESENCE
)

ui_fail() {
    echo "$*" >&2
    exit 1
}

ui_parse_args() {
    local operation="$1"
    shift
    UI_ENV_FILE=""
    UI_SKIP_BUILD=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env)
                [[ $# -ge 2 ]] || ui_fail "--env requires a file path"
                UI_ENV_FILE="$2"
                shift 2
                ;;
            --skip-build)
                [[ "$operation" == deploy ]] || ui_fail "--skip-build is only available for deployment"
                UI_SKIP_BUILD=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 --env <frontend-env-file>$([[ "$operation" == deploy ]] && printf ' [--skip-build]' || true)"
                exit 0
                ;;
            *) ui_fail "Unknown argument: $1" ;;
        esac
    done
    [[ -n "$UI_ENV_FILE" && -f "$UI_ENV_FILE" ]] || ui_fail "Supply an existing frontend env file with --env"
    UI_ENV_FILE="$(cd "$(dirname "$UI_ENV_FILE")" && pwd)/$(basename "$UI_ENV_FILE")"

    set -a
    # shellcheck disable=SC1090
    source "$UI_ENV_FILE"
    set +a

    UI_PUBLIC_BASE_URL="${UI_PUBLIC_BASE_URL:-}"
    UI_PUBLIC_BASE_URL="${UI_PUBLIC_BASE_URL%/}"
    [[ "$UI_PUBLIC_BASE_URL" =~ ^https?://[^/?#@[:space:]]+$ ]] || ui_fail "UI_PUBLIC_BASE_URL must be an HTTP(S) origin, for example https://app.example.com"
    : "${NEXT_PUBLIC_USER_SERVER_URL:=$UI_PUBLIC_BASE_URL/api/v1}"
    : "${NEXT_PUBLIC_API_URL:=$UI_PUBLIC_BASE_URL/api/v1}"
    : "${NEXT_PUBLIC_API_BASE_URL:=$UI_PUBLIC_BASE_URL/api/v1}"
    : "${NEXT_PUBLIC_IMAGE_SERVER_URL:=$UI_PUBLIC_BASE_URL/api/v1}"
    : "${NEXT_PUBLIC_SIGNALING_URL:=ws${UI_PUBLIC_BASE_URL#http}/ws}"

    UI_BUILD_ARGS=()
    local suffix name value
    for suffix in "${UI_PUBLIC_VARIABLES[@]}"; do
        name="NEXT_PUBLIC_$suffix"
        value="${!name:-}"
        [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || ui_fail "$name must be a single-line value"
        export "$name=$value"
        UI_BUILD_ARGS+=(--build-arg "$name=$value")
    done

    case "${UI_USE_LOCAL_PACKAGES_DIST:-false}" in
        true|1) UI_STATIC_BUILD_STAGE=builder-local-packages ;;
        false|0) UI_STATIC_BUILD_STAGE=builder ;;
        *) ui_fail "UI_USE_LOCAL_PACKAGES_DIST must be true or false" ;;
    esac
}
