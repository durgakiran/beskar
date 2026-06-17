#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_SCRIPTS_DIR="$ROOT_DIR/docker/scripts"

# shellcheck disable=SC1091
source "$DOCKER_SCRIPTS_DIR/common.sh"

usage() {
    cat <<'EOF'
Usage:
  backup/restore-postgres.sh --env docker/env/<environment>.env --timestamp <YYYYMMDDTHHMMSSZ> [--backup-config path]

The script reads the deployment env file plus optional backup-specific config and:
- downloads encrypted postgres dumps for the specified timestamp
- decrypts them locally
- restores globals using psql
- restores individual databases using pg_restore
EOF
}

BACKUP_CONFIG_ARG=""
TIMESTAMP_ARG=""
TMP_FILES=()
RUN_TMP_DIR=""
AWS_BASE_ARGS=()

parse_args() {
    if [[ $# -eq 0 ]]; then
        usage
        exit 1
    fi

    local remaining=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --backup-config)
                BACKUP_CONFIG_ARG="${2:-}"
                if [[ -z "$BACKUP_CONFIG_ARG" ]]; then
                    echo "Missing value for --backup-config" >&2
                    exit 1
                fi
                shift 2
                ;;
            --timestamp)
                TIMESTAMP_ARG="${2:-}"
                if [[ -z "$TIMESTAMP_ARG" ]]; then
                    echo "Missing value for --timestamp" >&2
                    exit 1
                fi
                shift 2
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                remaining+=("$1")
                shift
                ;;
        esac
    done

    if [[ -z "$TIMESTAMP_ARG" ]]; then
        echo "Error: --timestamp is required" >&2
        usage
        exit 1
    fi

    parse_env_arg "${remaining[@]}"
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S %z')] $*"
}

require_command() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Required command not found: $cmd" >&2
        exit 1
    fi
}

normalize_bucket() {
    local bucket="$1"
    bucket="${bucket#s3://}"
    bucket="${bucket%/}"
    printf '%s\n' "$bucket"
}

normalize_prefix() {
    local prefix="${1:-}"
    prefix="${prefix#/}"
    prefix="${prefix%/}"
    printf '%s\n' "$prefix"
}

load_backup_config() {
    if [[ -n "$BACKUP_CONFIG_ARG" ]]; then
        if [[ ! -f "$BACKUP_CONFIG_ARG" ]]; then
            echo "Backup config not found: $BACKUP_CONFIG_ARG" >&2
            exit 1
        fi
        set -a
        # shellcheck disable=SC1090
        source "$BACKUP_CONFIG_ARG"
        set +a
    fi

    if [[ -n "${BACKUP_CONFIG_FILE:-}" ]]; then
        if [[ ! -f "$BACKUP_CONFIG_FILE" ]]; then
            echo "Backup config not found: $BACKUP_CONFIG_FILE" >&2
            exit 1
        fi
        set -a
        # shellcheck disable=SC1090
        source "$BACKUP_CONFIG_FILE"
        set +a
    fi
}

backup_defaults() {
    : "${BACKUP_S3_BUCKET:=}"
    : "${BACKUP_S3_ENDPOINT:=}"
    : "${BACKUP_S3_PREFIX:=postgres}"
    : "${BACKUP_S3_REGION:=}"
    : "${BACKUP_AWS_ACCESS_KEY_ID:=}"
    : "${BACKUP_AWS_SECRET_ACCESS_KEY:=}"
    : "${BACKUP_ENCRYPTION_KEY_FILE:=}"
    : "${BACKUP_TMP_DIR:=/tmp/beskar-postgres-restore}"
    : "${BACKUP_ENVIRONMENT:=$(basename "$ENV_FILE" .env)}"
    : "${BACKUP_OPENSSL_CIPHER:=aes-256-cbc}"
    : "${BACKUP_OPENSSL_ITERATIONS:=200000}"

    require_var BACKUP_S3_BUCKET
    require_var BACKUP_AWS_ACCESS_KEY_ID
    require_var BACKUP_AWS_SECRET_ACCESS_KEY
    require_var BACKUP_ENCRYPTION_KEY_FILE

    if [[ ! -r "$BACKUP_ENCRYPTION_KEY_FILE" ]]; then
        echo "Encryption key file is missing or unreadable: $BACKUP_ENCRYPTION_KEY_FILE" >&2
        exit 1
    fi

    BACKUP_S3_BUCKET="$(normalize_bucket "$BACKUP_S3_BUCKET")"
    BACKUP_S3_PREFIX="$(normalize_prefix "$BACKUP_S3_PREFIX")"
    BACKUP_ENVIRONMENT="$(printf '%s' "$BACKUP_ENVIRONMENT" | tr '/ ' '__')"

    export AWS_ACCESS_KEY_ID="$BACKUP_AWS_ACCESS_KEY_ID"
    export AWS_SECRET_ACCESS_KEY="$BACKUP_AWS_SECRET_ACCESS_KEY"
    if [[ -n "$BACKUP_S3_REGION" ]]; then
        export AWS_DEFAULT_REGION="$BACKUP_S3_REGION"
    fi
}

aws_base_args() {
    local args=()
    if [[ -n "$BACKUP_S3_ENDPOINT" ]]; then
        args+=(--endpoint-url "$BACKUP_S3_ENDPOINT")
    fi
    if [[ -n "$BACKUP_S3_REGION" ]]; then
        args+=(--region "$BACKUP_S3_REGION")
    fi
    printf '%s\n' "${args[@]}"
}

init_aws_args() {
    AWS_BASE_ARGS=()
    while IFS= read -r arg; do
        AWS_BASE_ARGS+=("$arg")
    done < <(aws_base_args)
}

storage_uri() {
    local key="$1"
    printf 's3://%s/%s\n' "$BACKUP_S3_BUCKET" "$key"
}

storage_get() {
    local key="$1"
    local local_file="$2"
    aws s3 cp "$(storage_uri "$key")" "$local_file" "${AWS_BASE_ARGS[@]}"
}

cleanup() {
    local exit_code=$?

    if [[ ${#TMP_FILES[@]} -gt 0 ]]; then
        rm -f "${TMP_FILES[@]}" 2>/dev/null || true
    fi

    if [[ -n "${RUN_TMP_DIR:-}" && -d "$RUN_TMP_DIR" ]]; then
        rmdir "$RUN_TMP_DIR" 2>/dev/null || true
    fi

    exit "$exit_code"
}

register_tmp() {
    TMP_FILES+=("$1")
}

decrypt_file() {
    local encrypted_file="$1"
    local plain_file="$2"

    local key_file_path="$BACKUP_ENCRYPTION_KEY_FILE"
    if command -v cygpath >/dev/null 2>&1; then
        key_file_path="$(cygpath -m "$key_file_path")"
    fi

    openssl enc -d "-$BACKUP_OPENSSL_CIPHER" -pbkdf2 -iter "$BACKUP_OPENSSL_ITERATIONS" \
        -in "$encrypted_file" -out "$plain_file" -pass "file:$key_file_path"

    if [[ ! -s "$plain_file" ]]; then
        echo "Decrypted artifact is empty or decryption failed: $plain_file" >&2
        exit 1
    fi
}

object_key_for() {
    local artifact_name="$1"
    printf '%s/%s/%s/%s/%s/%s\n' \
        "$BACKUP_S3_PREFIX" \
        "$BACKUP_ENVIRONMENT" \
        "${TIMESTAMP_ARG:0:4}" \
        "${TIMESTAMP_ARG:4:2}" \
        "${TIMESTAMP_ARG:6:2}" \
        "$artifact_name"
}

compose_restore_globals() {
    local sql_file="$1"

    log "Restoring cluster globals"
    cat "$sql_file" | docker_compose exec -T -e "PGPASSWORD=$DB_ROOT_PASS" postgres \
        psql -h localhost -p "$DB_PORT" -U "$DB_ROOT_USER" -d postgres
}

compose_restore_db() {
    local db_name="$1"
    local dump_file="$2"

    log "Restoring database: $db_name"
    cat "$dump_file" | docker_compose exec -T -e "PGPASSWORD=$DB_ROOT_PASS" postgres \
        pg_restore -h localhost -p "$DB_PORT" -U "$DB_ROOT_USER" -d "$db_name" \
        --clean --if-exists
}

main() {
    parse_args "$@"
    load_env_file
    load_backup_config
    backup_defaults

    require_command docker
    require_command aws
    require_command openssl
    
    if [[ ! "$TIMESTAMP_ARG" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
        echo "Error: timestamp must be in format YYYYMMDDTHHMMSSZ (e.g., 20260420T023000Z)" >&2
        exit 1
    fi

    trap cleanup EXIT

    mkdir -p "$BACKUP_TMP_DIR"
    RUN_TMP_DIR="$(mktemp -d "$BACKUP_TMP_DIR/run.XXXXXX")"
    TMP_FILES=()

    render_all_templates
    docker_compose config >/dev/null
    init_aws_args

    log "Starting PostgreSQL restore for environment: $BACKUP_ENVIRONMENT (Timestamp: $TIMESTAMP_ARG)"

    local db key encrypted_file plain_file
    
    # 1. Restore Globals
    encrypted_file="$RUN_TMP_DIR/globals_${TIMESTAMP_ARG}.sql.enc"
    plain_file="$RUN_TMP_DIR/globals_${TIMESTAMP_ARG}.sql"
    register_tmp "$encrypted_file"
    register_tmp "$plain_file"

    key="$(object_key_for "globals_${TIMESTAMP_ARG}.sql.enc")"
    log "Downloading $key"
    if storage_get "$key" "$encrypted_file"; then
        log "Decrypting globals"
        decrypt_file "$encrypted_file" "$plain_file"
        compose_restore_globals "$plain_file"
    else
        log "Warning: Could not download globals. Skipping."
    fi

    # 2. Restore Databases
    DATABASES=("$DB_ROOT_DB" "$DB_APP_NAME" "$DB_AUTH_NAME" "$DB_ZITADEL_NAME")
    
    for db in "${DATABASES[@]}"; do
        encrypted_file="$RUN_TMP_DIR/${db}_${TIMESTAMP_ARG}.dump.enc"
        plain_file="$RUN_TMP_DIR/${db}_${TIMESTAMP_ARG}.dump"
        register_tmp "$encrypted_file"
        register_tmp "$plain_file"

        key="$(object_key_for "${db}_${TIMESTAMP_ARG}.dump.enc")"
        log "Downloading $key"
        if ! storage_get "$key" "$encrypted_file"; then
            log "Warning: Could not download $key. Skipping database $db."
            continue
        fi
        
        log "Decrypting $db dump"
        decrypt_file "$encrypted_file" "$plain_file"
        
        compose_restore_db "$db" "$plain_file"
    done

    log "Restore completed successfully."
}

main "$@"
