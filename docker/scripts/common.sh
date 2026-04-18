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

    : "${DB_HOST:=postgres}"
    : "${DB_PORT:=5432}"
    : "${POSTGRES_DATA_MOUNT:=postgres_data:/var/lib/postgresql/data}"
    : "${DB_ROOT_DB:=postgres}"
    : "${DB_APP_NAME:=beskar}"
    : "${DB_AUTH_NAME:=auth}"
    : "${DB_ZITADEL_NAME:=zitadel}"
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
    : "${BESKAR_SERVER_URL:=${PUBLIC_BASE_URL}}"
    : "${ZITADEL_ISSUER_URL:=${AUTH_PUBLIC_URL}}"
    : "${ZITADEL_EXTERNALDOMAIN:=${AUTH_DOMAIN}}"
    : "${ZITADEL_EXTERNALSECURE:=${TLS_ENABLED}}"
    : "${INSECURE_SKIP_VERIFY:=false}"
    : "${CORS_ALLOWED_ORIGINS:=${PUBLIC_BASE_URL}}"
    : "${UPLOAD_STORAGE_DIR:=public}"

    PROXY_DOMAIN_ALIASES_ENABLED="$(normalize_bool "$PROXY_DOMAIN_ALIASES_ENABLED")"
    ORIGIN_CERT_TRUST_INJECTION_ENABLED="$(normalize_bool "$ORIGIN_CERT_TRUST_INJECTION_ENABLED")"

    if [[ "$PROXY_DOMAIN_ALIASES_ENABLED" == "true" ]]; then
        PROXY_NETWORKS_BLOCK=$(cat <<EOF
    networks:
      app_net:
        aliases:
          - ${APP_DOMAIN}
          - ${AUTH_DOMAIN}
          - ${LANDING_DOMAIN}
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

    export COMPOSE_PROJECT_NAME
    export DOCKER_NETWORK_NAME
    export PROXY_HTTP_PORT
    export PROXY_HTTPS_PORT
    export PROXY_DOMAIN_ALIASES_ENABLED
    export ORIGIN_CERT_TRUST_INJECTION_ENABLED
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
    export BESKAR_SERVER_URL
    export CORS_ALLOWED_ORIGINS
    export INSECURE_SKIP_VERIFY
    export UPLOAD_STORAGE_DIR
    export DB_HOST
    export DB_PORT
    export POSTGRES_DATA_MOUNT
    export DB_ROOT_DB
    export DB_APP_NAME
    export DB_AUTH_NAME
    export DB_ZITADEL_NAME
    export REDIS_HOST
    export REDIS_PORT
    export PERMIFY_ENDPOINT
    export ZITADEL_ISSUER_URL
    export ZITADEL_EXTERNALDOMAIN
    export ZITADEL_EXTERNALSECURE
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
