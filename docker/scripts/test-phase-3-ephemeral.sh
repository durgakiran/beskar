#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="${P3_EPHEMERAL_RESULT_FILE:-${TMPDIR:-/tmp}/beskar-phase3-ephemeral.json}"
SHA256_FILE="${P3_EPHEMERAL_RESULT_SHA256_FILE:-${OUTPUT_FILE}.sha256}"
RUN_ID="${$}-${RANDOM}"
POSTGRES_CONTAINER="beskar-phase3-postgres-$RUN_ID"
MINIO_CONTAINER="beskar-phase3-minio-$RUN_ID"
NETWORK="beskar-phase3-$RUN_ID"
DIAGNOSTIC_DIR="${TMPDIR:-/tmp}/beskar-phase3-ephemeral-$RUN_ID"
ASSERTIONS_FILE="$DIAGNOSTIC_DIR/assertions.tsv"
MINIO_RESULT_FILE="$DIAGNOSTIC_DIR/minio-result.json"
MIGRATION_RESULT_FILE="$DIAGNOSTIC_DIR/migration-result.json"
DATABASE_RESTORE_RESULT_FILE="$DIAGNOSTIC_DIR/database-restore-result.json"
QUOTA_RESULT_FILE="$DIAGNOSTIC_DIR/quota-result.json"
FILESYSTEM_RESULT_FILE="$DIAGNOSTIC_DIR/filesystem-result.json"

cleanup() {
  local rc=$?
  mkdir -p "$DIAGNOSTIC_DIR" || true
  for container in "$POSTGRES_CONTAINER" "$MINIO_CONTAINER"; do
    if docker inspect "$container" >/dev/null 2>&1; then
      docker logs "$container" >"$DIAGNOSTIC_DIR/$container.log" 2>&1 || true
      if [[ $rc -ne 0 ]]; then
        echo "Phase 3 diagnostics for $container:" >&2
        sed -n '1,400p' "$DIAGNOSTIC_DIR/$container.log" >&2 || true
      fi
      docker rm -f "$container" >/dev/null 2>&1 || true
    fi
  done
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  if [[ $rc -ne 0 ]]; then
    echo "Complete disposable-topology diagnostics: $DIAGNOSTIC_DIR" >&2
  fi
  return "$rc"
}
trap cleanup EXIT INT TERM

record_assertion() {
  printf '%s\t%s\n' "$1" "$2" >>"$ASSERTIONS_FILE"
}

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: Docker is required for repository-owned Phase 3 probes." >&2
  exit 2
fi
if [[ "$OUTPUT_FILE" == "$SHA256_FILE" ]]; then
  echo "FAIL: ephemeral JSON and SHA-256 sidecar must use distinct paths." >&2
  exit 2
fi
mkdir -p "$DIAGNOSTIC_DIR" "$(dirname "$OUTPUT_FILE")" "$(dirname "$SHA256_FILE")"
: >"$ASSERTIONS_FILE"

docker network create "$NETWORK" >/dev/null
docker run --detach --name "$POSTGRES_CONTAINER" --network "$NETWORK" --network-alias postgres \
  --publish 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data:rw,size=768m \
  --env POSTGRES_DB=phase3 --env POSTGRES_USER=phase3 --env POSTGRES_PASSWORD=phase3 \
  postgres:16-alpine >/dev/null
docker run --detach --name "$MINIO_CONTAINER" --network "$NETWORK" --network-alias minio \
  --publish 127.0.0.1::9000 \
  --tmpfs /data:rw,size=384m --tmpfs /home/nonroot:rw,size=16m \
  --env MINIO_ROOT_USER=phase3-access --env MINIO_ROOT_PASSWORD=phase3-secret \
  cgr.dev/chainguard/minio:latest server /data --address :9000 >/dev/null

for _ in $(seq 1 45); do
  if docker exec "$POSTGRES_CONTAINER" pg_isready -U phase3 -d phase3 >/dev/null 2>&1; then
    sleep 2
    docker exec "$POSTGRES_CONTAINER" pg_isready -U phase3 -d phase3 >/dev/null 2>&1 && break
  fi
  sleep 1
done
docker exec "$POSTGRES_CONTAINER" pg_isready -U phase3 -d phase3 >/dev/null
mapped_pg="$(docker port "$POSTGRES_CONTAINER" 5432/tcp | head -n 1)"
pg_port="${mapped_pg##*:}"
mapped_s3="$(docker port "$MINIO_CONTAINER" 9000/tcp | head -n 1)"
s3_port="${mapped_s3##*:}"
[[ "$pg_port" =~ ^[0-9]+$ && "$s3_port" =~ ^[0-9]+$ ]]

docker exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U phase3 -d phase3 <<'SQL' >/dev/null
CREATE USER beskar_app;
CREATE SCHEMA core;
CREATE SCHEMA billing;
CREATE TABLE billing.account (id uuid PRIMARY KEY, user_id uuid);
CREATE TABLE core.space (id uuid PRIMARY KEY, account_id uuid NOT NULL, deleted_at timestamptz);
CREATE TABLE core.page (id bigint PRIMARY KEY, space_id uuid NOT NULL);
CREATE TABLE core.asset_reference (
  asset_type text, page_id bigint, asset_id text,
  CONSTRAINT ck_asset_reference_asset_type CHECK (asset_type IN ('attachment', 'image'))
);
CREATE TABLE billing.space_usage (space_id uuid PRIMARY KEY, storage_bytes_used bigint NOT NULL DEFAULT 0, storage_bytes_reserved bigint NOT NULL DEFAULT 0, updated_at timestamptz, last_reconciled_at timestamptz);
CREATE TABLE billing.account_subscription (id uuid PRIMARY KEY, account_id uuid NOT NULL, plan_id uuid NOT NULL, status text, effective_from timestamptz, effective_to timestamptz, source text, created_at timestamptz);
CREATE TABLE billing.plan_limit (plan_id uuid, metric_key text, limit_value bigint, limit_unit text, enforcement_mode text);
CREATE TABLE billing.space_usage_event (space_id uuid, metric_key text, event_type text, delta_value bigint, source_type text, source_id text, correlation_id text, metadata jsonb, created_at timestamptz);
INSERT INTO billing.account VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
INSERT INTO core.space VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', NULL);
INSERT INTO core.page VALUES (41, '22222222-2222-4222-8222-222222222222');
SQL

for _ in $(seq 1 45); do
  curl -fsS "http://127.0.0.1:$s3_port/minio/health/ready" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$s3_port/minio/health/ready" >/dev/null

docker run --rm --network "$NETWORK" -v "$ROOT_DIR:/workspace:ro" liquibase/liquibase:4.27.0 \
  --url=jdbc:postgresql://postgres:5432/phase3 --username=phase3 --password=phase3 \
  --changelog-file=db/beskar/updates/whiteboard_assets.xml \
  --search-path=/workspace update -Dapp_user=beskar_app \
  >"$DIAGNOSTIC_DIR/liquibase.log" 2>&1
docker exec "$POSTGRES_CONTAINER" psql -At -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c \
  "SELECT json_build_object('resource_id', current_database(), 'row_count', count(*), 'changelogs', json_agg(json_build_object('id',id,'author',author,'filename',filename,'checksum',md5sum,'order_executed',orderexecuted) ORDER BY orderexecuted)) FROM databasechangelog WHERE id IN ('whiteboard_assets_1','whiteboard_assets_2_reference_type','whiteboard_assets_3_staging_transactions','whiteboard_assets_4_terminal_cleanup_sweeper','whiteboard_assets_5_cleanup_dead_letter');" \
  >"$MIGRATION_RESULT_FILE"
python3 - "$MIGRATION_RESULT_FILE" <<'PY'
import json, pathlib, sys
value = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert value["row_count"] == 5
assert all(row["id"] and row["filename"] and row["checksum"] for row in value["changelogs"])
PY
record_assertion migration real_liquibase_changelog_applied

(
  cd "$ROOT_DIR/server"
  P3_REAL_S3_ENDPOINT="http://127.0.0.1:$s3_port" P3_REAL_S3_RESULT_FILE="$MINIO_RESULT_FILE" \
    GOCACHE="${TMPDIR:-/tmp}/beskar-phase3-go-cache" GOWORK=off \
    go test -count=1 -run '^TestPhase3RealS3CompatibleProbe$' ./storage
)
record_assertion s3_compatible real_minio_dedupe_delete_retry_restore

docker exec "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c \
  "INSERT INTO core.whiteboard_asset (page_id,content_hash,storage_key,file_size,mime_type,width,height,created_by,inspector_version) VALUES (41,repeat('c',64),'restore/probe',1,'image/png',1,1,'phase3',1);" >/dev/null
docker exec "$POSTGRES_CONTAINER" pg_dump -U phase3 -d phase3 --data-only --table=core.whiteboard_asset \
  >"$DIAGNOSTIC_DIR/whiteboard_asset.sql"
pre_restore_rows="$(docker exec "$POSTGRES_CONTAINER" psql -At -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c 'SELECT count(*) FROM core.whiteboard_asset;')"
docker exec "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c 'TRUNCATE core.whiteboard_asset CASCADE;' >/dev/null
deleted_rows="$(docker exec "$POSTGRES_CONTAINER" psql -At -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c 'SELECT count(*) FROM core.whiteboard_asset;')"
docker exec -i "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U phase3 -d phase3 \
  <"$DIAGNOSTIC_DIR/whiteboard_asset.sql" >/dev/null
post_restore_rows="$(docker exec "$POSTGRES_CONTAINER" psql -At -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c 'SELECT count(*) FROM core.whiteboard_asset;')"
[[ "$pre_restore_rows" == 1 && "$deleted_rows" == 0 && "$post_restore_rows" == 1 ]]
dump_sha256="$(shasum -a 256 "$DIAGNOSTIC_DIR/whiteboard_asset.sql" | awk '{print $1}')"
python3 - "$DATABASE_RESTORE_RESULT_FILE" "$pre_restore_rows" "$deleted_rows" "$post_restore_rows" "$dump_sha256" <<'PY'
import json, pathlib, sys
path, before, deleted, restored, digest = sys.argv[1:]
value = {"resource_id":"core.whiteboard_asset:restore/probe","row_count_before":int(before),"row_count_after_delete":int(deleted),"row_count_after_restore":int(restored),"dump_sha256":digest}
pathlib.Path(path).write_text(json.dumps(value, sort_keys=True)+"\n")
PY
record_assertion database_restore dump_truncate_restore_observed_rows
docker exec "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c \
  "DELETE FROM core.whiteboard_asset WHERE storage_key='restore/probe';" >/dev/null

(
  cd "$ROOT_DIR/server"
  P3_GO_ASSET_INTEGRATION=1 P3_REAL_S3_ENDPOINT="http://127.0.0.1:$s3_port" \
  PG_HOST=127.0.0.1 PG_PORT="$pg_port" PG_DB=phase3 PG_USER=phase3 PG_PASSWORD=phase3 \
  QUOTA_SYSTEM_ENABLED=true GOCACHE="${TMPDIR:-/tmp}/beskar-phase3-go-cache" GOWORK=off \
    go test -count=1 -run '^TestPhase3WhiteboardAssetServiceIntegrationCoverage$' ./media/services
)
record_assertion quota_cleanup service_dedupe_quota_release_cleanup_retry
docker exec "$POSTGRES_CONTAINER" psql -At -v ON_ERROR_STOP=1 -U phase3 -d phase3 -c \
  "SELECT json_build_object('resource_id','space:22222222-2222-4222-8222-222222222222','asset_rows',(SELECT count(*) FROM core.whiteboard_asset),'staging_rows',(SELECT count(*) FROM core.whiteboard_asset_staging),'usage_event_rows',(SELECT count(*) FROM billing.space_usage_event),'used_bytes',COALESCE((SELECT storage_bytes_used FROM billing.space_usage WHERE space_id='22222222-2222-4222-8222-222222222222'),0),'reserved_bytes',COALESCE((SELECT storage_bytes_reserved FROM billing.space_usage WHERE space_id='22222222-2222-4222-8222-222222222222'),0));" \
  >"$QUOTA_RESULT_FILE"

filesystem_root="$DIAGNOSTIC_DIR/filesystem"
P3_FILESYSTEM_PROBE_ROOT="$filesystem_root" GOCACHE="${TMPDIR:-/tmp}/beskar-phase3-go-cache" GOWORK=off \
  go test -C "$ROOT_DIR/server" -count=1 -run '^TestPhase3FilesystemAdapterProbe$' ./storage
record_assertion filesystem real_filesystem_dedupe_delete_retry_restore
python3 - "$filesystem_root" "$FILESYSTEM_RESULT_FILE" <<'PY'
import hashlib, json, pathlib, sys
root, output = map(pathlib.Path, sys.argv[1:])
files = sorted(path for path in root.rglob('*') if path.is_file())
digest = hashlib.sha256()
for path in files:
    relative = str(path.relative_to(root)); data = path.read_bytes()
    digest.update(relative.encode()); digest.update(b'\0'); digest.update(data)
output.write_text(json.dumps({"resource_id":str(root),"file_count":len(files),"tree_sha256":digest.hexdigest()}, sort_keys=True)+"\n")
PY

temporary_output="${OUTPUT_FILE}.${$}.${RANDOM}.tmp"
python3 - "$ASSERTIONS_FILE" "$temporary_output" "$MIGRATION_RESULT_FILE" "$MINIO_RESULT_FILE" "$QUOTA_RESULT_FILE" "$FILESYSTEM_RESULT_FILE" "$DATABASE_RESTORE_RESULT_FILE" <<'PY'
import json, pathlib, sys
assertions_path, output_path, *observation_paths = map(pathlib.Path, sys.argv[1:])
observed = {}
for line in assertions_path.read_text(encoding="utf-8").splitlines():
    probe, assertion = line.split("\t", 1)
    observed.setdefault(probe, []).append(assertion)
expected = {"migration", "s3_compatible", "quota_cleanup", "filesystem", "database_restore"}
if set(observed) != expected or any(not values for values in observed.values()):
    raise SystemExit(f"incomplete observed assertions: {observed}")
observations = dict(zip(["migration", "s3_compatible", "quota_cleanup", "filesystem", "database_restore"], [json.loads(path.read_text()) for path in observation_paths]))
value = {
    "schema_version": 3,
    "producer": "docker/scripts/test-phase-3-ephemeral.sh",
    "result": "pass",
    "probes": {
        name: {"status": "pass", "resource": observations[name]["resource_id"] if "resource_id" in observations[name] else observations[name]["object_key"], "assertions": observed[name], "observed": observations[name]}
        for name in sorted(observed)
    },
}
output_path.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
PY
chmod 0600 "$temporary_output"
mv -f "$temporary_output" "$OUTPUT_FILE"
digest="$(shasum -a 256 "$OUTPUT_FILE" | awk '{print $1}')"
temporary_sidecar="${SHA256_FILE}.${$}.${RANDOM}.tmp"
printf '%s  %s\n' "$digest" "$(basename "$OUTPUT_FILE")" >"$temporary_sidecar"
chmod 0600 "$temporary_sidecar"
mv -f "$temporary_sidecar" "$SHA256_FILE"

python3 - "$OUTPUT_FILE" "$SHA256_FILE" <<'PY'
import hashlib, json, pathlib, re, sys
result_path, sidecar_path = map(pathlib.Path, sys.argv[1:])
value = json.loads(result_path.read_text(encoding="utf-8"))
assert set(value) == {"schema_version", "producer", "result", "probes"}
assert value["schema_version"] == 3 and value["producer"] == "docker/scripts/test-phase-3-ephemeral.sh" and value["result"] == "pass"
assert set(value["probes"]) == {"migration", "s3_compatible", "quota_cleanup", "filesystem", "database_restore"}
for probe in value["probes"].values():
    assert set(probe) == {"status", "resource", "assertions", "observed"}
    assert probe["status"] == "pass" and probe["resource"] and probe["assertions"] and probe["observed"]
minio = value["probes"]["s3_compatible"]["observed"]
assert minio["source_version_id"] != minio["restored_version_id"]
assert minio["delete_marker_version_id"] and len(minio["content_sha256"]) == 64 and len(minio["metadata_sha256"]) == 64
migration = value["probes"]["migration"]["observed"]
assert migration["row_count"] == len(migration["changelogs"]) == 5
restore = value["probes"]["database_restore"]["observed"]
assert (restore["row_count_before"], restore["row_count_after_delete"], restore["row_count_after_restore"]) == (1,0,1)
match = re.fullmatch(r"([0-9a-f]{64})  ([^/\n]+)\n", sidecar_path.read_text(encoding="ascii"))
assert match and match.group(2) == result_path.name
assert hashlib.sha256(result_path.read_bytes()).hexdigest() == match.group(1)
PY
echo "repository-owned Phase 3 probes passed: $OUTPUT_FILE"
echo "validated SHA-256 sidecar: $SHA256_FILE"
