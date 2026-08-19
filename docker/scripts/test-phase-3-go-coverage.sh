#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE="/tmp/beskar-phase3-whiteboard-assets.cover"
RAW_REPORT="/tmp/beskar-phase3-go-coverage.raw.json"
BUILD_ARTIFACT="/tmp/beskar-phase3-artifacts/beskar-server"
GOCACHE_DIR="${TMPDIR:-/tmp}/beskar-phase3-go-cache"
CONTAINER="beskar-phase3-coverage-${$}-${RANDOM}"
DIAGNOSTIC_FILE="${TMPDIR:-/tmp}/${CONTAINER}.log"

cleanup() {
  local rc=$?
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker logs "$CONTAINER" >"$DIAGNOSTIC_FILE" 2>&1 || true
    if [[ $rc -ne 0 ]]; then
      echo "Phase 3 coverage PostgreSQL diagnostics preserved at $DIAGNOSTIC_FILE" >&2
      sed -n '1,240p' "$DIAGNOSTIC_FILE" >&2
    fi
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  return "$rc"
}
trap cleanup EXIT INT TERM

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: Docker is required for the owned Phase 3 Go integration coverage topology." >&2
  exit 2
fi

docker run --detach --name "$CONTAINER" \
  --publish 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data:rw,size=768m \
  --env POSTGRES_DB=phase3 \
  --env POSTGRES_USER=phase3 \
  --env POSTGRES_PASSWORD=phase3 \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U phase3 -d phase3 >/dev/null 2>&1; then
    sleep 2
    if docker exec "$CONTAINER" pg_isready -U phase3 -d phase3 >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 1
done
if ! docker exec "$CONTAINER" pg_isready -U phase3 -d phase3 >/dev/null 2>&1; then
  echo "FAIL: disposable Phase 3 PostgreSQL did not become ready." >&2
  exit 1
fi

docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U phase3 -d phase3 <<'SQL' >/dev/null
CREATE SCHEMA core;
CREATE SCHEMA billing;
CREATE TABLE billing.account (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE core.space (id uuid PRIMARY KEY, account_id uuid NOT NULL, deleted_at timestamptz);
CREATE TABLE core.page (id bigint PRIMARY KEY, space_id uuid NOT NULL);
CREATE TABLE billing.space_usage (space_id uuid PRIMARY KEY, storage_bytes_used bigint NOT NULL DEFAULT 0, storage_bytes_reserved bigint NOT NULL DEFAULT 0, updated_at timestamptz, last_reconciled_at timestamptz);
CREATE TABLE billing.account_subscription (id uuid PRIMARY KEY, account_id uuid NOT NULL, plan_id uuid NOT NULL, status text, effective_from timestamptz, effective_to timestamptz, source text, created_at timestamptz);
CREATE TABLE billing.plan_limit (plan_id uuid, metric_key text, limit_value bigint, limit_unit text, enforcement_mode text);
CREATE TABLE billing.space_usage_event (space_id uuid, metric_key text, event_type text, delta_value bigint, source_type text, source_id text, correlation_id text, metadata jsonb, created_at timestamptz);
INSERT INTO billing.account VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO core.space VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', NULL);
INSERT INTO core.page VALUES (41, '22222222-2222-4222-8222-222222222222');
CREATE TABLE core.whiteboard_asset (page_id bigint NOT NULL, content_hash text NOT NULL, storage_key text NOT NULL UNIQUE, file_size bigint NOT NULL, mime_type text NOT NULL, width integer NOT NULL, height integer NOT NULL, created_by text NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb, inspector_version integer NOT NULL, PRIMARY KEY (page_id, content_hash));
CREATE TABLE core.asset_reference (asset_type text, page_id bigint, asset_id text);
CREATE TABLE core.whiteboard_asset_staging (token uuid PRIMARY KEY, page_id bigint NOT NULL, content_hash text NOT NULL, storage_key text NOT NULL, created_by text NOT NULL, status text NOT NULL, file_size bigint NOT NULL DEFAULT 0, mime_type text, width integer, height integer, quota_account_id uuid, quota_space_id uuid, quota_reserved_bytes bigint NOT NULL DEFAULT 0, quota_correlation_id text, created_asset boolean NOT NULL DEFAULT false, cleanup_attempts integer NOT NULL DEFAULT 0, next_cleanup_at timestamptz, cleanup_error text, cleanup_source_status text, cleanup_exhausted_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
SQL

mapped="$(docker port "$CONTAINER" 5432/tcp | head -n 1)"
port="${mapped##*:}"
if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "FAIL: unable to discover disposable PostgreSQL port." >&2
  exit 1
fi

(
  cd "$ROOT_DIR/server"
  P3_GO_ASSET_INTEGRATION=1 \
  PG_HOST=127.0.0.1 PG_PORT="$port" PG_DB=phase3 PG_USER=phase3 PG_PASSWORD=phase3 \
  QUOTA_SYSTEM_ENABLED=true \
  GOCACHE="$GOCACHE_DIR" GOWORK=off \
  go test -count=1 -covermode=atomic \
    -coverpkg=./media/services,./media/controller,./editor,./quota,./storage,. \
    -coverprofile="$PROFILE" ./media/services ./media/controller ./editor ./quota ./storage .
)

mkdir -p "$(dirname "$BUILD_ARTIFACT")"
rm -f "$BUILD_ARTIFACT"
(cd "$ROOT_DIR/server" && GOCACHE="$GOCACHE_DIR" GOWORK=off go build -trimpath -o "$BUILD_ARTIFACT" .)
test -s "$BUILD_ARTIFACT"

docker run --rm \
  --env GOWORK=off \
  -v "$ROOT_DIR:/workspace:ro" -v "/tmp:/tmp" -w /workspace \
  golang:1.24 go run ./docker/scripts/phase-3-go-coverage-report.go \
  -root /workspace -profile "$PROFILE" -output "$RAW_REPORT"
node "$ROOT_DIR/docker/scripts/bind-phase-3-coverage.mjs" go
node "$ROOT_DIR/docker/scripts/verify-phase-3-coverage.mjs" --report=go
