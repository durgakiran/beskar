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
  backup/backup-postgres.sh --env docker/env/<environment>.env [--backup-config path]

The script reads the deployment env file plus optional backup-specific config and:
- renders/validates the generated compose config
- dumps postgres, beskar, auth, zitadel, and globals
- encrypts artifacts locally with openssl
- uploads encrypted objects to an S3-compatible backend
- prunes old snapshots using daily/weekly/monthly retention
EOF
}

BACKUP_CONFIG_ARG=""
TMP_FILES=()
RUN_TMP_DIR=""
LOCK_MODE=""
LOCK_DIR=""
TIMESTAMP_UTC=""
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
    : "${BACKUP_TMP_DIR:=/tmp/beskar-postgres-backup}"
    : "${BACKUP_RETENTION_DAILY:=7}"
    : "${BACKUP_RETENTION_WEEKLY:=4}"
    : "${BACKUP_RETENTION_MONTHLY:=6}"
    : "${BACKUP_LOCK_FILE:=/tmp/beskar-postgres-backup.lock}"
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

storage_put() {
    local local_file="$1"
    local key="$2"
    aws s3 cp "$local_file" "$(storage_uri "$key")" "${AWS_BASE_ARGS[@]}"
}

storage_delete() {
    local key="$1"
    aws s3 rm "$(storage_uri "$key")" "${AWS_BASE_ARGS[@]}"
}

storage_head() {
    local key="$1"
    aws s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$key" "${AWS_BASE_ARGS[@]}" >/dev/null
}

storage_list() {
    local output
    output="$(
        aws s3api list-objects-v2 \
        --bucket "$BACKUP_S3_BUCKET" \
        --prefix "$BACKUP_S3_PREFIX/" \
        --query 'Contents[].Key' \
        --output text \
        "${AWS_BASE_ARGS[@]}"
    )"

    if [[ -z "$output" || "$output" == "None" ]]; then
        return 0
    fi

    printf '%s\n' "$output" | tr '\t' '\n'
}

date_parse() {
    local timestamp="$1"
    local format="$2"

    if date -u -d "1970-01-01 UTC" '+%Y' >/dev/null 2>&1; then
        date -u -d "${timestamp:0:4}-${timestamp:4:2}-${timestamp:6:2} ${timestamp:9:2}:${timestamp:11:2}:${timestamp:13:2} UTC" +"$format"
    else
        date -u -j -f "%Y%m%dT%H%M%SZ" "$timestamp" +"$format"
    fi
}

timestamp_day() {
    local timestamp="$1"
    date_parse "$timestamp" "%Y-%m-%d"
}

timestamp_week() {
    local timestamp="$1"
    date_parse "$timestamp" "%G-W%V"
}

timestamp_month() {
    local timestamp="$1"
    date_parse "$timestamp" "%Y-%m"
}

init_lock() {
    if command -v flock >/dev/null 2>&1; then
        exec 9>"$BACKUP_LOCK_FILE"
        if ! flock -n 9; then
            echo "Backup already running: $BACKUP_LOCK_FILE" >&2
            exit 1
        fi
        LOCK_MODE="flock"
        return
    fi

    LOCK_DIR="${BACKUP_LOCK_FILE}.d"
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        echo "Backup already running: $LOCK_DIR" >&2
        exit 1
    fi
    LOCK_MODE="mkdir"
}

cleanup() {
    local exit_code=$?

    if [[ ${#TMP_FILES[@]:-0} -gt 0 ]]; then
        rm -f "${TMP_FILES[@]}" 2>/dev/null || true
    fi

    if [[ -n "${RUN_TMP_DIR:-}" && -d "$RUN_TMP_DIR" ]]; then
        rmdir "$RUN_TMP_DIR" 2>/dev/null || true
    fi

    if [[ "${LOCK_MODE:-}" == "mkdir" && -n "${LOCK_DIR:-}" ]]; then
        rmdir "$LOCK_DIR" 2>/dev/null || true
    fi

    exit "$exit_code"
}

register_tmp() {
    TMP_FILES+=("$1")
}

compose_pg_dump() {
    local db_name="$1"
    local out_file="$2"

    log "Dumping database: $db_name"
    docker_compose exec -T -e "PGPASSWORD=$DB_ROOT_PASS" postgres \
        pg_dump -h localhost -p "$DB_PORT" -U "$DB_ROOT_USER" -d "$db_name" -Fc > "$out_file"
}

compose_pg_dump_globals() {
    local out_file="$1"

    log "Dumping cluster globals"
    docker_compose exec -T -e "PGPASSWORD=$DB_ROOT_PASS" postgres \
        pg_dumpall -h localhost -p "$DB_PORT" -U "$DB_ROOT_USER" --globals-only > "$out_file"
}

encrypt_file() {
    local plain_file="$1"
    local encrypted_file="$2"

    openssl enc "-$BACKUP_OPENSSL_CIPHER" -salt -pbkdf2 -iter "$BACKUP_OPENSSL_ITERATIONS" \
        -in "$plain_file" -out "$encrypted_file" -pass "file:$BACKUP_ENCRYPTION_KEY_FILE"

    if [[ ! -s "$encrypted_file" ]]; then
        echo "Encrypted artifact is empty: $encrypted_file" >&2
        exit 1
    fi

    rm -f "$plain_file"
}

object_key_for() {
    local artifact_name="$1"
    printf '%s/%s/%s/%s/%s/%s\n' \
        "$BACKUP_S3_PREFIX" \
        "$BACKUP_ENVIRONMENT" \
        "${TIMESTAMP_UTC:0:4}" \
        "${TIMESTAMP_UTC:4:2}" \
        "${TIMESTAMP_UTC:6:2}" \
        "$artifact_name"
}

collect_snapshots() {
    local keys_file="$1"
    local snapshots_file="$2"

    if [[ ! -s "$keys_file" ]]; then
        : > "$snapshots_file"
        return
    fi

    awk '
        /_[0-9]{8}T[0-9]{6}Z\.(dump|sql)\.enc$/ {
            value = $0
            sub(/^.*_/, "", value)
            sub(/\.(dump|sql)\.enc$/, "", value)
            print value
        }
    ' "$keys_file" | sort -u -r > "$snapshots_file"
}

apply_retention() {
    local keys_file="$1"
    local snapshots_file="$2"
    local keep_file="$3"
    local seen_days_file seen_weeks_file seen_months_file

    : > "$keep_file"
    seen_days_file="$RUN_TMP_DIR/seen-days.txt"
    seen_weeks_file="$RUN_TMP_DIR/seen-weeks.txt"
    seen_months_file="$RUN_TMP_DIR/seen-months.txt"
    : > "$seen_days_file"
    : > "$seen_weeks_file"
    : > "$seen_months_file"

    local daily_count=0
    local weekly_count=0
    local monthly_count=0

    while IFS= read -r timestamp; do
        [[ -n "$timestamp" ]] || continue

        local day_key week_key month_key
        day_key="$(timestamp_day "$timestamp")"
        week_key="$(timestamp_week "$timestamp")"
        month_key="$(timestamp_month "$timestamp")"

        if (( daily_count < BACKUP_RETENTION_DAILY )) && ! grep -qxF "$day_key" "$seen_days_file"; then
            echo "$day_key" >> "$seen_days_file"
            echo "$timestamp" >> "$keep_file"
            ((daily_count += 1))
            continue
        fi

        if (( weekly_count < BACKUP_RETENTION_WEEKLY )) && ! grep -qxF "$week_key" "$seen_weeks_file"; then
            echo "$week_key" >> "$seen_weeks_file"
            echo "$timestamp" >> "$keep_file"
            ((weekly_count += 1))
            continue
        fi

        if (( monthly_count < BACKUP_RETENTION_MONTHLY )) && ! grep -qxF "$month_key" "$seen_months_file"; then
            echo "$month_key" >> "$seen_months_file"
            echo "$timestamp" >> "$keep_file"
            ((monthly_count += 1))
        fi
    done < "$snapshots_file"
}

prune_old_backups() {
    local keys_file snapshots_file keep_file
    keys_file="$RUN_TMP_DIR/remote-keys.txt"
    snapshots_file="$RUN_TMP_DIR/snapshots.txt"
    keep_file="$RUN_TMP_DIR/keep.txt"

    storage_list | sed '/^$/d' | sort > "$keys_file" || true
    collect_snapshots "$keys_file" "$snapshots_file"
    apply_retention "$keys_file" "$snapshots_file" "$keep_file"

    if [[ ! -s "$snapshots_file" ]]; then
        log "No remote snapshots found to prune"
        return
    fi

    local deleted=0
    while IFS= read -r timestamp; do
        [[ -n "$timestamp" ]] || continue
        if grep -qx "$timestamp" "$keep_file"; then
            continue
        fi

        while IFS= read -r key; do
            [[ -n "$key" ]] || continue
            log "Deleting old backup object: $key"
            storage_delete "$key"
            deleted=1
        done < <(grep -E "_${timestamp}\.(dump|sql)\.enc$" "$keys_file" || true)
    done < "$snapshots_file"

    if (( deleted == 0 )); then
        log "Retention pruning found nothing to delete"
    fi
}

main() {
    parse_args "$@"
    load_env_file
    load_backup_config
    backup_defaults

    require_command docker
    require_command aws
    require_command openssl
    require_command awk
    require_command sed

    init_lock
    trap cleanup EXIT

    mkdir -p "$BACKUP_TMP_DIR"
    RUN_TMP_DIR="$(mktemp -d "$BACKUP_TMP_DIR/run.XXXXXX")"

    TIMESTAMP_UTC="$(date -u +%Y%m%dT%H%M%SZ)"
    DATABASES=("$DB_ROOT_DB" "$DB_APP_NAME" "$DB_AUTH_NAME" "$DB_ZITADEL_NAME")
    TMP_FILES=()

    render_all_templates
    docker_compose config >/dev/null
    init_aws_args

    log "Starting PostgreSQL backup for environment: $BACKUP_ENVIRONMENT"

    local db plain_file encrypted_file key

    for db in "${DATABASES[@]}"; do
        plain_file="$RUN_TMP_DIR/${db}_${TIMESTAMP_UTC}.dump"
        encrypted_file="${plain_file}.enc"
        register_tmp "$plain_file"
        register_tmp "$encrypted_file"

        compose_pg_dump "$db" "$plain_file"
        if [[ ! -s "$plain_file" ]]; then
            echo "Plaintext dump is empty: $plain_file" >&2
            exit 1
        fi

        encrypt_file "$plain_file" "$encrypted_file"
        key="$(object_key_for "$(basename "$encrypted_file")")"
        storage_put "$encrypted_file" "$key"
        storage_head "$key"
        log "Uploaded encrypted dump: $key"
    done

    plain_file="$RUN_TMP_DIR/globals_${TIMESTAMP_UTC}.sql"
    encrypted_file="${plain_file}.enc"
    register_tmp "$plain_file"
    register_tmp "$encrypted_file"

    compose_pg_dump_globals "$plain_file"
    if [[ ! -s "$plain_file" ]]; then
        echo "Globals dump is empty: $plain_file" >&2
        exit 1
    fi

    encrypt_file "$plain_file" "$encrypted_file"
    key="$(object_key_for "$(basename "$encrypted_file")")"
    storage_put "$encrypted_file" "$key"
    storage_head "$key"
    log "Uploaded encrypted globals dump: $key"

    prune_old_backups
    log "Backup completed successfully"
}

main "$@"
