#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKER_DIR="$ROOT_DIR/docker"
GENERATED_DIR="$DOCKER_DIR/.generated"

usage_env_flag() {
    echo "Usage: $0 --env <path-to-env-file>" >&2
}

parse_env_arg() {
    local env_file=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env)
                env_file="${2:-}"
                shift 2
                ;;
            *)
                echo "Unknown argument: $1" >&2
                usage_env_flag
                exit 1
                ;;
        esac
    done

    if [[ -z "$env_file" ]]; then
        usage_env_flag
        exit 1
    fi

    if [[ ! -f "$env_file" ]]; then
        echo "Env file not found: $env_file" >&2
        exit 1
    fi

    ENV_FILE="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"
    export ENV_FILE
}

normalize_bool() {
    local value="${1:-false}"
    value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    case "$value" in
        1|true|yes|on) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

require_var() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        echo "Missing required variable: $name" >&2
        exit 1
    fi
}

load_env_file() {
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a

    TLS_ENABLED="$(normalize_bool "${TLS_ENABLED:-true}")"
    export TLS_ENABLED

    local public_scheme="https"
    local websocket_scheme="wss"
    if [[ "$TLS_ENABLED" != "true" ]]; then
        public_scheme="http"
        websocket_scheme="ws"
    fi

    : "${COMPOSE_PROJECT_NAME:=beskar-prod}"
    : "${DOCKER_NETWORK_NAME:=beskar-network}"
    : "${PROXY_HTTP_PORT:=80}"
    : "${PROXY_HTTPS_PORT:=443}"
    : "${PROXY_DOMAIN_ALIASES_ENABLED:=true}"
    : "${ORIGIN_CERT_TRUST_INJECTION_ENABLED:=true}"
    : "${UI_USE_LOCAL_PACKAGES_DIST:=false}"
    : "${DOCKER_LOG_MAX_SIZE:=10m}"
    : "${DOCKER_LOG_MAX_FILE:=3}"
    : "${LANDING_DOMAIN_ALIASES:=}"

    : "${DB_HOST:=postgres}"
    : "${DB_PORT:=5432}"
    : "${POSTGRES_DATA_MOUNT:=postgres_data:/var/lib/postgresql/data}"
    : "${DB_ROOT_DB:=postgres}"
    : "${DB_APP_NAME:=beskar}"
    : "${DB_AUTH_NAME:=auth}"
    : "${DB_ZITADEL_NAME:=zitadel}"
    : "${ZITADEL_IMAGE:=ghcr.io/zitadel/zitadel:v4.13.0}"
    : "${ZITADEL_LOGIN_V2_REQUIRED:=false}"
    : "${REDIS_HOST:=redis}"
    : "${REDIS_PORT:=6379}"
    : "${PERMIFY_ENDPOINT:=guard:3478}"
    : "${NEXTAUTH_URL_INTERNAL:=http://ui:3000}"

    require_var APP_DOMAIN
    require_var AUTH_DOMAIN
    require_var LANDING_DOMAIN
    require_var NEXTAUTH_SECRET
    require_var NPM_TOKEN
    require_var DB_ROOT_USER
    require_var DB_ROOT_PASS
    require_var DB_ADMIN_USERNAME
    require_var DB_ADMIN_PASSWORD
    require_var DB_APP_USERNAME
    require_var DB_APP_PASSWORD
    require_var REDIS_PASSWORD
    require_var PERMIFY_SECRET
    require_var ZITADEL_MASTER_KEY
    require_var ZITADEL_ADMIN_USERNAME
    require_var ZITADEL_ADMIN_PASSWORD
    require_var ZITADEL_CLIENT_ID
    require_var ZITADEL_CLIENT_SECRET
    require_var ZITADEL_USER_PAT

    if [[ "$TLS_ENABLED" == "true" ]]; then
        require_var TLS_CERT_PATH
        require_var TLS_KEY_PATH
    fi

    : "${PUBLIC_BASE_URL:=${public_scheme}://${APP_DOMAIN}}"
    : "${AUTH_PUBLIC_URL:=${public_scheme}://${AUTH_DOMAIN}}"
    : "${LANDING_PUBLIC_URL:=${public_scheme}://${LANDING_DOMAIN}}"
    : "${NEXTAUTH_URL:=${PUBLIC_BASE_URL}}"
    : "${NEXT_PUBLIC_USER_SERVER_URL:=${PUBLIC_BASE_URL}/api/v1}"
    : "${NEXT_PUBLIC_API_URL:=${PUBLIC_BASE_URL}/api/v1}"
    : "${NEXT_PUBLIC_API_BASE_URL:=${PUBLIC_BASE_URL}/api/v1}"
    : "${NEXT_PUBLIC_IMAGE_SERVER_URL:=${PUBLIC_BASE_URL}/api/v1}"
    : "${NEXT_PUBLIC_SIGNALING_URL:=${websocket_scheme}://${APP_DOMAIN}/ws}"
    : "${NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT:=}"
    : "${NEXT_PUBLIC_PAGE_EVENTS_SSE:=}"
    : "${NEXT_PUBLIC_PAGE_EVENTS_TRANSPORT_LOG:=}"
    : "${NEXT_PUBLIC_EDITOR_PRESENCE:=}"
    : "${EDITOR_INACTIVE_THRESHOLD_SEC:=75}"
    : "${EDITOR_NEW_DRAFT_MIN_PAYLOAD_BYTES:=64}"
    : "${BESKAR_SERVER_URL:=${PUBLIC_BASE_URL}}"
    : "${ZITADEL_ISSUER_URL:=${AUTH_PUBLIC_URL}}"
    : "${ZITADEL_EXTERNALDOMAIN:=${AUTH_DOMAIN}}"
    : "${ZITADEL_EXTERNALSECURE:=${TLS_ENABLED}}"
    : "${ZITADEL_REGISTRATION_ORG_ID:=}"
    : "${INSECURE_SKIP_VERIFY:=false}"
    : "${CORS_ALLOWED_ORIGINS:=${PUBLIC_BASE_URL}}"
    : "${UPLOAD_STORAGE_DIR:=public}"
    : "${STORAGE_S3_BUCKET:=}"
    : "${STORAGE_S3_ENDPOINT:=}"
    : "${STORAGE_S3_REGION:=}"
    : "${STORAGE_S3_ACCESS_KEY_ID:=}"
    : "${STORAGE_S3_SECRET_ACCESS_KEY:=}"
    : "${STORAGE_S3_PREFIX:=}"
    : "${STORAGE_S3_BASE_URL:=}"
    : "${EMAIL_NOTIFICATIONS_ENABLED:=false}"
    : "${EMAIL_WORKER_ENABLED:=false}"
    : "${EMAIL_ADMIN_ENABLED:=false}"
    : "${EMAIL_ADMIN_TOKEN:=}"
    : "${EMAIL_PROVIDER:=smtp}"
    : "${EMAIL_FROM_ADDRESS:=}"
    : "${EMAIL_FROM_NAME:=Beskar}"
    : "${EMAIL_APP_BASE_URL:=${PUBLIC_BASE_URL}}"
    : "${SMTP_HOST:=}"
    : "${SMTP_PORT:=587}"
    : "${SMTP_USERNAME:=}"
    : "${SMTP_PASSWORD:=}"
    : "${SMTP_USE_TLS:=true}"
    : "${SMTP_TIMEOUT_SECONDS:=10}"
    : "${EMAIL_WORKER_POLL_INTERVAL_SECONDS:=10}"
    : "${EMAIL_WORKER_BATCH_SIZE:=25}"
    : "${EMAIL_MAX_ATTEMPTS:=10}"
    : "${EMAIL_RETRY_INITIAL_SECONDS:=30}"
    : "${EMAIL_RETRY_MAX_SECONDS:=21600}"
    : "${QUOTA_SYSTEM_ENABLED:=true}"
    : "${QUOTA_STORAGE_BLOCKING_ENABLED:=true}"
    : "${QUOTA_COLLABORATOR_BLOCKING_ENABLED:=true}"
    : "${QUOTA_MONITOR_ONLY:=false}"
    : "${QUOTA_RECONCILIATION_ENABLED:=false}"
    : "${QUOTA_RECONCILIATION_INTERVAL:=6h}"
    : "${QUOTA_ADMIN_ENABLED:=false}"
    : "${QUOTA_ADMIN_TOKEN:=}"
    : "${ASSET_CLEANUP_ENABLED:=false}"
    : "${ASSET_CLEANUP_DRY_RUN:=true}"
    : "${ASSET_CLEANUP_PURGE_ENABLED:=false}"
    : "${ASSET_CLEANUP_ADMIN_ENABLED:=false}"
    : "${ASSET_CLEANUP_ADMIN_TOKEN:=}"
    : "${ASSET_CLEANUP_MARK_INTERVAL:=1h}"
    : "${ASSET_CLEANUP_PURGE_INTERVAL:=6h}"
    : "${ASSET_CLEANUP_ORPHAN_GRACE:=24h}"
    : "${ASSET_CLEANUP_PURGE_GRACE:=168h}"
    : "${ASSET_CLEANUP_MAX_MARKS_PER_RUN:=100}"
    : "${ASSET_CLEANUP_MAX_PURGES_PER_RUN:=50}"
    : "${DOCUMENT_VERSION_CLEANUP_ENABLED:=false}"
    : "${DOCUMENT_VERSION_CLEANUP_DRY_RUN:=true}"
    : "${DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED:=false}"
    : "${DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN:=}"
    : "${DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS:=7}"
    : "${DOCUMENT_VERSION_CLEANUP_BATCH_SIZE:=500}"
    : "${DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN:=500}"
    : "${DOCUMENT_VERSION_CLEANUP_INTERVAL:=24h}"
    : "${POSTGRES_LOG_MIN_MESSAGES:=warning}"
    : "${REDIS_LOG_LEVEL:=warning}"
    : "${PERMIFY_LOG_LEVEL:=warn}"
    : "${ZITADEL_ACCESS_LOG_STDOUT_ENABLED:=false}"
    : "${SERVER_LOG_TO_FILES:=false}"
    : "${SERVER_LOG_LEVEL:=error}"
    : "${SERVER_HTTP_REQUEST_LOGGING_ENABLED:=false}"
    : "${SERVER_DB_POOL_DEBUG_LOGS:=false}"

    LANDING_DOMAIN_NAMES="$LANDING_DOMAIN"
    LANDING_PROXY_ALIASES_BLOCK="          - ${LANDING_DOMAIN}"
    if [[ -n "${LANDING_DOMAIN_ALIASES// }" ]]; then
        local landing_alias
        for landing_alias in $LANDING_DOMAIN_ALIASES; do
            LANDING_DOMAIN_NAMES="${LANDING_DOMAIN_NAMES} ${landing_alias}"
            LANDING_PROXY_ALIASES_BLOCK="${LANDING_PROXY_ALIASES_BLOCK}
          - ${landing_alias}"
        done
    fi

    PROXY_DOMAIN_ALIASES_ENABLED="$(normalize_bool "$PROXY_DOMAIN_ALIASES_ENABLED")"
    ORIGIN_CERT_TRUST_INJECTION_ENABLED="$(normalize_bool "$ORIGIN_CERT_TRUST_INJECTION_ENABLED")"
    UI_USE_LOCAL_PACKAGES_DIST="$(normalize_bool "$UI_USE_LOCAL_PACKAGES_DIST")"
    ZITADEL_ACCESS_LOG_STDOUT_ENABLED="$(normalize_bool "$ZITADEL_ACCESS_LOG_STDOUT_ENABLED")"
    SERVER_LOG_TO_FILES="$(normalize_bool "$SERVER_LOG_TO_FILES")"
    SERVER_HTTP_REQUEST_LOGGING_ENABLED="$(normalize_bool "$SERVER_HTTP_REQUEST_LOGGING_ENABLED")"
    SERVER_DB_POOL_DEBUG_LOGS="$(normalize_bool "$SERVER_DB_POOL_DEBUG_LOGS")"
    QUOTA_SYSTEM_ENABLED="$(normalize_bool "$QUOTA_SYSTEM_ENABLED")"
    QUOTA_STORAGE_BLOCKING_ENABLED="$(normalize_bool "$QUOTA_STORAGE_BLOCKING_ENABLED")"
    QUOTA_COLLABORATOR_BLOCKING_ENABLED="$(normalize_bool "$QUOTA_COLLABORATOR_BLOCKING_ENABLED")"
    QUOTA_MONITOR_ONLY="$(normalize_bool "$QUOTA_MONITOR_ONLY")"
    QUOTA_RECONCILIATION_ENABLED="$(normalize_bool "$QUOTA_RECONCILIATION_ENABLED")"
    QUOTA_ADMIN_ENABLED="$(normalize_bool "$QUOTA_ADMIN_ENABLED")"
    ASSET_CLEANUP_ENABLED="$(normalize_bool "$ASSET_CLEANUP_ENABLED")"
    ASSET_CLEANUP_DRY_RUN="$(normalize_bool "$ASSET_CLEANUP_DRY_RUN")"
    ASSET_CLEANUP_PURGE_ENABLED="$(normalize_bool "$ASSET_CLEANUP_PURGE_ENABLED")"
    ASSET_CLEANUP_ADMIN_ENABLED="$(normalize_bool "$ASSET_CLEANUP_ADMIN_ENABLED")"
    DOCUMENT_VERSION_CLEANUP_ENABLED="$(normalize_bool "$DOCUMENT_VERSION_CLEANUP_ENABLED")"
    DOCUMENT_VERSION_CLEANUP_DRY_RUN="$(normalize_bool "$DOCUMENT_VERSION_CLEANUP_DRY_RUN")"
    DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED="$(normalize_bool "$DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED")"

    if [[ "$UI_USE_LOCAL_PACKAGES_DIST" == "true" ]]; then
        UI_DOCKER_BUILD_TARGET="runner-local-packages"
        if [[ ! -f "$ROOT_DIR/packages/editor/dist/index.js" ]]; then
            echo "UI_USE_LOCAL_PACKAGES_DIST=true requires built editor files at $ROOT_DIR/packages/editor/dist" >&2
            echo "Run: npm --prefix packages/editor run build" >&2
            exit 1
        fi
        if [[ ! -f "$ROOT_DIR/packages/glideboard/dist/index.js" ]]; then
            echo "UI_USE_LOCAL_PACKAGES_DIST=true requires built glideboard files at $ROOT_DIR/packages/glideboard/dist" >&2
            echo "Run: npm --prefix packages/glideboard run build" >&2
            exit 1
        fi
        if [[ ! -f "$ROOT_DIR/packages/glideline/dist/index.js" ]]; then
            echo "UI_USE_LOCAL_PACKAGES_DIST=true requires built glideline files at $ROOT_DIR/packages/glideline/dist" >&2
            echo "Run: npm --prefix packages/glideline run build" >&2
            exit 1
        fi
        if [[ ! -f "$ROOT_DIR/packages/canvas-text-editor/dist/index.js" ]]; then
            echo "UI_USE_LOCAL_PACKAGES_DIST=true requires built canvas text editor files at $ROOT_DIR/packages/canvas-text-editor/dist" >&2
            echo "Run: npm --prefix packages/canvas-text-editor run build" >&2
            exit 1
        fi
    else
        UI_DOCKER_BUILD_TARGET="runner"
    fi

    if [[ "$PROXY_DOMAIN_ALIASES_ENABLED" == "true" ]]; then
        PROXY_NETWORKS_BLOCK=$(cat <<EOF
    networks:
      app_net:
        aliases:
          - ${APP_DOMAIN}
          - ${AUTH_DOMAIN}
${LANDING_PROXY_ALIASES_BLOCK}
EOF
)
    else
        PROXY_NETWORKS_BLOCK=$(cat <<'EOF'
    networks:
      - app_net
EOF
)
    fi

    if [[ "$ORIGIN_CERT_TRUST_INJECTION_ENABLED" == "true" ]]; then
        UI_ORIGIN_CA_ENV_BLOCK='      NODE_EXTRA_CA_CERTS: /etc/ssl/certs/beskar-cert.pem'
        SERVER_ORIGIN_CA_ENV_BLOCK='      SSL_CERT_FILE: /etc/ssl/certs/beskar-cert.pem'
        UI_ORIGIN_CA_VOLUMES_BLOCK=$(cat <<'EOF'
    volumes:
      - {{TLS_CERT_PATH}}:/etc/ssl/certs/beskar-cert.pem:ro
EOF
)
        SERVER_ORIGIN_CA_VOLUMES_BLOCK=$(cat <<'EOF'
    volumes:
      - {{TLS_CERT_PATH}}:/etc/ssl/certs/beskar-cert.pem:ro
EOF
)
    else
        UI_ORIGIN_CA_ENV_BLOCK=''
        SERVER_ORIGIN_CA_ENV_BLOCK=''
        UI_ORIGIN_CA_VOLUMES_BLOCK=''
        SERVER_ORIGIN_CA_VOLUMES_BLOCK=''
    fi

    DOCKER_LOGGING_BLOCK=$(cat <<EOF
    logging:
      driver: json-file
      options:
        max-size: "${DOCKER_LOG_MAX_SIZE}"
        max-file: "${DOCKER_LOG_MAX_FILE}"
EOF
)

    export COMPOSE_PROJECT_NAME
    export DOCKER_NETWORK_NAME
    export PROXY_HTTP_PORT
    export PROXY_HTTPS_PORT
    export PROXY_DOMAIN_ALIASES_ENABLED
    export ORIGIN_CERT_TRUST_INJECTION_ENABLED
    export UI_USE_LOCAL_PACKAGES_DIST
    export LANDING_DOMAIN_ALIASES
    export LANDING_DOMAIN_NAMES
    export DOCKER_LOG_MAX_SIZE
    export DOCKER_LOG_MAX_FILE
    export DOCKER_LOGGING_BLOCK
    export UI_DOCKER_BUILD_TARGET
    export PUBLIC_BASE_URL
    export AUTH_PUBLIC_URL
    export LANDING_PUBLIC_URL
    export NEXTAUTH_URL
    export NEXTAUTH_URL_INTERNAL
    export NEXT_PUBLIC_USER_SERVER_URL
    export NEXT_PUBLIC_API_URL
    export NEXT_PUBLIC_API_BASE_URL
    export NEXT_PUBLIC_IMAGE_SERVER_URL
    export NEXT_PUBLIC_SIGNALING_URL
    export NEXT_PUBLIC_HASURA_PROJECT_ENDPOINT
    export NEXT_PUBLIC_PAGE_EVENTS_SSE
    export NEXT_PUBLIC_PAGE_EVENTS_TRANSPORT_LOG
    export NEXT_PUBLIC_EDITOR_PRESENCE
    export EDITOR_INACTIVE_THRESHOLD_SEC
    export EDITOR_NEW_DRAFT_MIN_PAYLOAD_BYTES
    export REDIS_PASSWORD
    export BESKAR_SERVER_URL
    export CORS_ALLOWED_ORIGINS
    export INSECURE_SKIP_VERIFY
    export UPLOAD_STORAGE_DIR
    export STORAGE_S3_BUCKET
    export STORAGE_S3_ENDPOINT
    export STORAGE_S3_REGION
    export STORAGE_S3_ACCESS_KEY_ID
    export STORAGE_S3_SECRET_ACCESS_KEY
    export STORAGE_S3_PREFIX
    export STORAGE_S3_BASE_URL
    export EMAIL_NOTIFICATIONS_ENABLED
    export EMAIL_WORKER_ENABLED
    export EMAIL_ADMIN_ENABLED
    export EMAIL_ADMIN_TOKEN
    export EMAIL_PROVIDER
    export EMAIL_FROM_ADDRESS
    export EMAIL_FROM_NAME
    export EMAIL_APP_BASE_URL
    export SMTP_HOST
    export SMTP_PORT
    export SMTP_USERNAME
    export SMTP_PASSWORD
    export SMTP_USE_TLS
    export SMTP_TIMEOUT_SECONDS
    export EMAIL_WORKER_POLL_INTERVAL_SECONDS
    export EMAIL_WORKER_BATCH_SIZE
    export EMAIL_MAX_ATTEMPTS
    export EMAIL_RETRY_INITIAL_SECONDS
    export EMAIL_RETRY_MAX_SECONDS
    export QUOTA_SYSTEM_ENABLED
    export QUOTA_STORAGE_BLOCKING_ENABLED
    export QUOTA_COLLABORATOR_BLOCKING_ENABLED
    export QUOTA_MONITOR_ONLY
    export QUOTA_RECONCILIATION_ENABLED
    export QUOTA_RECONCILIATION_INTERVAL
    export QUOTA_ADMIN_ENABLED
    export QUOTA_ADMIN_TOKEN
    export ASSET_CLEANUP_ENABLED
    export ASSET_CLEANUP_DRY_RUN
    export ASSET_CLEANUP_PURGE_ENABLED
    export ASSET_CLEANUP_ADMIN_ENABLED
    export ASSET_CLEANUP_ADMIN_TOKEN
    export ASSET_CLEANUP_MARK_INTERVAL
    export ASSET_CLEANUP_PURGE_INTERVAL
    export ASSET_CLEANUP_ORPHAN_GRACE
    export ASSET_CLEANUP_PURGE_GRACE
    export ASSET_CLEANUP_MAX_MARKS_PER_RUN
    export ASSET_CLEANUP_MAX_PURGES_PER_RUN
    export DOCUMENT_VERSION_CLEANUP_ENABLED
    export DOCUMENT_VERSION_CLEANUP_DRY_RUN
    export DOCUMENT_VERSION_CLEANUP_ADMIN_ENABLED
    export DOCUMENT_VERSION_CLEANUP_ADMIN_TOKEN
    export DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS
    export DOCUMENT_VERSION_CLEANUP_BATCH_SIZE
    export DOCUMENT_VERSION_CLEANUP_MAX_DOCS_PER_RUN
    export DOCUMENT_VERSION_CLEANUP_INTERVAL
    export POSTGRES_LOG_MIN_MESSAGES
    export REDIS_LOG_LEVEL
    export PERMIFY_LOG_LEVEL
    export ZITADEL_ACCESS_LOG_STDOUT_ENABLED
    export SERVER_LOG_TO_FILES
    export SERVER_LOG_LEVEL
    export SERVER_HTTP_REQUEST_LOGGING_ENABLED
    export SERVER_DB_POOL_DEBUG_LOGS
    export DB_HOST
    export DB_PORT
    export POSTGRES_DATA_MOUNT
    export DB_ROOT_DB
    export DB_APP_NAME
    export DB_AUTH_NAME
    export DB_ZITADEL_NAME
    export ZITADEL_IMAGE
    export ZITADEL_LOGIN_V2_REQUIRED
    export REDIS_HOST
    export REDIS_PORT
    export PERMIFY_ENDPOINT
    export ZITADEL_ISSUER_URL
    export ZITADEL_EXTERNALDOMAIN
    export ZITADEL_EXTERNALSECURE
    export ZITADEL_REGISTRATION_ORG_ID
    export PROXY_NETWORKS_BLOCK
    export UI_ORIGIN_CA_ENV_BLOCK
    export UI_ORIGIN_CA_VOLUMES_BLOCK
    export SERVER_ORIGIN_CA_ENV_BLOCK
    export SERVER_ORIGIN_CA_VOLUMES_BLOCK
}

render_template() {
    local template_file="$1"
    local output_file="$2"

    mkdir -p "$(dirname "$output_file")"

    awk '
    function escape_replacement(value) {
        gsub(/\\/, "\\\\", value)
        gsub(/&/, "\\&", value)
        return value
    }
    {
        line = $0
        while (match(line, /\{\{[A-Z0-9_]+\}\}/)) {
            key = substr(line, RSTART + 2, RLENGTH - 4)
            value = escape_replacement(ENVIRON[key])
            line = substr(line, 1, RSTART - 1) value substr(line, RSTART + RLENGTH)
        }
        print line
    }' "$template_file" > "$output_file"
}

compose_file_path() {
    printf '%s/compose.yml' "$GENERATED_DIR"
}

render_all_templates() {
    mkdir -p "$GENERATED_DIR/nginx"

    local compose_template
    local nginx_template

    if [[ "$TLS_ENABLED" == "true" ]]; then
        compose_template="$DOCKER_DIR/templates/compose.https.yml.tmpl"
        nginx_template="$DOCKER_DIR/templates/nginx.https.conf.tmpl"
    else
        compose_template="$DOCKER_DIR/templates/compose.http.yml.tmpl"
        nginx_template="$DOCKER_DIR/templates/nginx.http.conf.tmpl"
    fi

    render_template "$compose_template" "$(compose_file_path)"
    render_template "$nginx_template" "$GENERATED_DIR/nginx/default.conf"
}

docker_compose() {
    docker compose -f "$(compose_file_path)" -p "$COMPOSE_PROJECT_NAME" "$@"
}
