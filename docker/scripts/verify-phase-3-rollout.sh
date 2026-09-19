#!/usr/bin/env bash

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE_FILE="$ROOT_DIR/docs/runbooks/phase-3-rollout-evidence.tsv"
REPORT_FILE="${TMPDIR:-/tmp}/phase-3-rollout-report.md"
RUN_EPHEMERAL="${P3_RUN_EPHEMERAL:-0}"
RUN_BROWSER="${P3_RUN_BROWSER_SECURITY:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --evidence) EVIDENCE_FILE="${2:-}"; shift 2 ;;
    --report) REPORT_FILE="${2:-}"; shift 2 ;;
    --help)
      echo "Usage: $0 [--evidence evidence.tsv] [--report report.md]"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

expected_gates=(
  migration_deployed object_store_modes quota_modes deployed_browser_security
  authorization tenant_isolation encryption backup_restore deletion_retention
  local_recovery_privacy telemetry_redaction abuse_controls decoder_isolation_decision
)

declare -a local_rows=()
declare -a owner_rows=()
failures=0

record_local() {
  local label="$1" status="$2" detail="$3"
  detail="${detail//|/\\|}"
  detail="${detail//$'\n'/<br>}"
  local_rows+=("| $label | $status | $detail |")
  [[ "$status" == "PASS" ]] || failures=$((failures + 1))
}

run_local() {
  local label="$1" command="$2" output rc
  if output="$(cd "$ROOT_DIR" && /bin/bash -euo pipefail -c "$command" 2>&1)"; then
    record_local "$label" PASS "$output"
  else
    rc=$?
    record_local "$label" FAIL "exit $rc: $output"
  fi
}

validate_migration() {
  python3 - "$ROOT_DIR" <<'PY'
import pathlib, sys, xml.etree.ElementTree as ET
root = pathlib.Path(sys.argv[1])
master = ET.parse(root / 'db/beskar/update.xml')
asset = ET.parse(root / 'db/beskar/updates/whiteboard_assets.xml')
includes = [node.attrib.get('file') for node in master.getroot() if node.tag.endswith('include')]
assert 'updates/whiteboard_assets.xml' in includes, 'whiteboard asset changelog is not included'
xml = ET.tostring(asset.getroot(), encoding='unicode')
for required in ('whiteboard_asset', 'page_id, content_hash', 'whiteboard_asset_storage_key_uq', 'onDelete="CASCADE"'):
    assert required in xml, f'missing migration invariant: {required}'
print('migration XML and invariants verified')
PY
}

if [[ ! -f "$EVIDENCE_FILE" ]]; then
  echo "Evidence file not found: $EVIDENCE_FILE" >&2
  exit 2
fi
if [[ "$REPORT_FILE" == "$EVIDENCE_FILE" ]]; then
  echo "Report must not overwrite the evidence file." >&2
  exit 2
fi

if migration_output="$(validate_migration 2>&1)"; then
  record_local "Migration contract" PASS "$migration_output"
else
  record_local "Migration contract" FAIL "$migration_output"
fi
run_local "Server focused tests" "cd server && GOCACHE=${TMPDIR:-/tmp}/beskar-phase3-go-cache GOWORK=off go test ./media/services ./media/controller ./storage ./quota"
run_local "Phase 3 TypeScript coverage" "npm --prefix packages/glideline run test:phase3:coverage"
run_local "Phase 3 Glideboard coverage" "npm --prefix packages/glideboard run test:phase3:coverage"
run_local "Phase 3 demo adapter coverage" "npm --prefix packages/glideline-demo run test:phase3:coverage"
run_local "Phase 3 production UI coverage" "npm --prefix ui run test:phase3:coverage"
run_local "Phase 3 Go coverage" "./docker/scripts/test-phase-3-go-coverage.sh"
run_local "Phase 3 manifest coverage" "node ./docker/scripts/verify-phase-3-coverage.mjs"

if [[ "$RUN_EPHEMERAL" == "1" ]]; then
  run_local "Ephemeral migration/storage/quota/restore" "./docker/scripts/test-phase-3-ephemeral.sh"
else
  record_local "Ephemeral migration/storage/quota/restore" BLOCKED "Set P3_RUN_EPHEMERAL=1 to run the fixed repository-owned probes"
fi

if [[ "$RUN_BROWSER" == "1" ]]; then
  run_local "Deployed browser security" "npm --prefix packages/glideboard run test:e2e:phase3-security"
else
  record_local "Deployed browser security" BLOCKED "Set P3_RUN_BROWSER_SECURITY=1 with the deployed topology variables"
fi

header="$(head -n 1 "$EVIDENCE_FILE")"
if [[ "$header" != $'gate_id\tstatus\towner\treviewer\tenvironment\tbuild_digest\tprocedure\tresult\tverified_at_utc\tartifact_url\tartifact_sha256\tnotes' ]]; then
  echo "Invalid evidence header in $EVIDENCE_FILE" >&2
  exit 2
fi

owner_output="$(python3 - "$EVIDENCE_FILE" "${expected_gates[@]}" <<'PY'
import csv, datetime as dt, hashlib, http.client, ipaddress, os, re, socket, ssl, sys, urllib.parse

path, *expected = sys.argv[1:]
rows, seen, failures = [], set(), 0

def clean(value):
    return (value or '').replace('|', r'\|').replace('\n', ' ')

placeholders = {'', 'nobody', 'none', 'unknown', 'n/a', 'na', 'unassigned', 'tbd', 'todo'}
placeholder_words = re.compile(r'(^|[^a-z])(example|placeholder|sample|dummy|test)([^a-z]|$)', re.I)
allowed_artifact_hosts = {
    host.strip().lower().rstrip('.')
    for host in os.environ.get('P3_EVIDENCE_ALLOWED_HOSTS', '').split(',')
    if host.strip()
}

def person(value):
    value = (value or '').strip()
    return len(value) >= 3 and value.lower() not in placeholders and not placeholder_words.search(value) and bool(re.search(r'[A-Za-z]', value))

def environment(value):
    value = (value or '').strip()
    return value.lower() not in placeholders and not placeholder_words.search(value) and bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}', value))

def artifact_bytes(value):
    try:
        current = value
        for redirect_count in range(6):
            parsed = urllib.parse.urlsplit(current)
            hostname = (parsed.hostname or '').lower().rstrip('.')
            if (parsed.scheme != 'https' or not hostname or parsed.username or parsed.password
                    or parsed.port not in (None, 443) or parsed.query or parsed.fragment):
                raise ValueError('artifact URL must be credential-free HTTPS on port 443')
            if hostname not in allowed_artifact_hosts:
                raise ValueError('artifact host is not exactly allowlisted')
            if hostname in {'localhost', 'metadata.google.internal'} or hostname.endswith(('.localhost', '.local', '.internal', '.example', '.invalid', '.test')):
                raise ValueError('local, metadata, or placeholder artifact host')
            addresses = {
                item[4][0] for item in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
            }
            if not addresses:
                raise ValueError('artifact host did not resolve')
            parsed_addresses = [ipaddress.ip_address(address) for address in addresses]
            if any(not address.is_global for address in parsed_addresses):
                raise ValueError('artifact DNS includes non-public address')
            selected = sorted(addresses)[0]

            class PinnedHTTPSConnection(http.client.HTTPSConnection):
                def connect(self):
                    raw = socket.create_connection((selected, 443), timeout=self.timeout)
                    self.sock = self._context.wrap_socket(raw, server_hostname=hostname)

            connection = PinnedHTTPSConnection(hostname, 443, timeout=15, context=ssl.create_default_context())
            request_path = urllib.parse.urlunsplit(('', '', parsed.path or '/', '', ''))
            connection.request('GET', request_path, headers={'Accept': 'application/octet-stream', 'User-Agent': 'beskar-phase3-evidence/1'})
            response = connection.getresponse()
            peer = ipaddress.ip_address(connection.sock.getpeername()[0])
            if str(peer) != str(ipaddress.ip_address(selected)) or not peer.is_global:
                connection.close()
                raise ValueError('artifact connection was rebound')
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader('Location')
                response.read()
                connection.close()
                if not location or redirect_count == 5:
                    raise ValueError('invalid or excessive artifact redirect')
                current = urllib.parse.urljoin(current, location)
                continue
            if response.status != 200:
                connection.close()
                raise ValueError(f'artifact HTTP status {response.status}')
            length = response.getheader('Content-Length')
            if length and int(length) > 20 * 1024 * 1024:
                connection.close()
                raise ValueError('artifact exceeds byte limit')
            content = response.read(20 * 1024 * 1024 + 1)
            connection.close()
            return content
        raise ValueError('artifact redirect limit exceeded')
    except (OSError, ValueError, ssl.SSLError, http.client.HTTPException):
        return None

def utc_timestamp(value):
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.utcoffset() == dt.timedelta(0) and parsed <= dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)
    except (AttributeError, ValueError):
        return False

with open(path, newline='', encoding='utf-8') as handle:
    for row in csv.DictReader(handle, delimiter='\t'):
        gate = row.get('gate_id', '')
        status = row.get('status', '')
        owner = row.get('owner', '')
        reviewer = row.get('reviewer', '')
        env = row.get('environment', '')
        digest = row.get('build_digest', '')
        procedure = row.get('procedure', '')
        result = row.get('result', '')
        verified = row.get('verified_at_utc', '')
        artifact = row.get('artifact_url', '')
        artifact_digest = row.get('artifact_sha256', '')
        notes = row.get('notes', '')
        detail = notes or artifact
        if gate not in expected:
            status, detail = 'invalid', 'Unknown gate id'
            failures += 1
        elif gate in seen or None in row:
            status, detail = 'invalid', 'Duplicate row or extra column'
            failures += 1
        else:
            seen.add(gate)
            if status in {'supplied', 'blocking'}:
                errors = []
                if not person(owner): errors.append('owner')
                if not person(reviewer) or reviewer.strip().lower() == owner.strip().lower(): errors.append('independent reviewer')
                if not environment(env): errors.append('environment')
                if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest): errors.append('build_digest')
                if len(procedure.strip()) < 12 or procedure.strip().lower() in placeholders or placeholder_words.search(procedure): errors.append('procedure')
                if result not in {'pass', 'fail'}: errors.append('result')
                if status == 'supplied' and result != 'pass': errors.append('supplied result=pass')
                if status == 'blocking' and result != 'fail': errors.append('blocking result=fail')
                if not utc_timestamp(verified): errors.append('UTC timestamp')
                if not re.fullmatch(r'sha256:[0-9a-f]{64}', artifact_digest): errors.append('artifact_sha256')
                artifact_content = artifact_bytes(artifact)
                if artifact_content is None or len(artifact_content) > 20 * 1024 * 1024:
                    errors.append('readable non-placeholder artifact_url')
                elif 'artifact_sha256' not in errors and hashlib.sha256(artifact_content).hexdigest() != artifact_digest[7:]:
                    errors.append('artifact digest match')
                if status == 'blocking' and len(notes.strip()) < 8: errors.append('blocking notes')
                if errors:
                    status, detail = 'invalid', 'Invalid or missing: ' + ', '.join(errors)
                    failures += 1
            elif status == 'required':
                evidence_fields = [reviewer, env, digest, procedure, result, verified, artifact, artifact_digest]
                if owner.strip().upper() != 'UNASSIGNED' or any(value.strip() for value in evidence_fields):
                    status, detail = 'invalid', 'required rows must use owner UNASSIGNED and leave evidence fields empty'
                failures += 1
            else:
                status, detail = 'invalid', 'status must be required, supplied, or blocking'
                failures += 1
        rows.append(f'| {clean(gate)} | {status} | {clean(owner or "UNASSIGNED")} | {clean(reviewer)} | {clean(env)} | {clean(result)} | {clean(detail)} |')

for gate in expected:
    if gate not in seen:
        rows.append(f'| {gate} | missing | UNASSIGNED |  |  |  | Required roadmap gate is absent from evidence |')
        failures += 1

print(failures)
print('\n'.join(rows))
PY
)"
owner_rc=$?
if [[ $owner_rc -ne 0 ]]; then
  record_local "Owner evidence validator" FAIL "exit $owner_rc: $owner_output"
  owner_output=$'1\n| validator | invalid | UNASSIGNED |  |  |  | Owner evidence validator crashed; see local diagnostics |'
fi
owner_failures="${owner_output%%$'\n'*}"
if [[ ! "$owner_failures" =~ ^[0-9]+$ ]]; then
  record_local "Owner evidence validator" FAIL "validator emitted a non-numeric failure count: $owner_failures"
  owner_failures=1
fi
failures=$((failures + owner_failures))
while IFS= read -r row; do owner_rows+=("$row"); done <<< "${owner_output#*$'\n'}"

if ! mkdir -p "$(dirname "$REPORT_FILE")"; then
  echo "Failed to create report directory: $(dirname "$REPORT_FILE")" >&2
  exit 1
fi
report_tmp="${REPORT_FILE}.${$}.${RANDOM}.tmp"
trap 'rm -f "$report_tmp"' EXIT INT TERM
{
  echo "# Phase 3 Rollout Evidence Report"
  echo
  echo "Generated (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "Result: $([[ $failures -eq 0 ]] && echo PASS || echo FAIL) ($failures blocking or failed checks)"
  echo
  echo "## Local automated evidence"
  echo
  echo "| Check | Result | Detail |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${local_rows[@]}"
  echo
  echo "## Environment and owner evidence"
  echo
  echo "| Roadmap gate | Status | Owner | Reviewer | Environment | Result | Detail |"
  echo "| --- | --- | --- | --- | --- | --- | --- |"
  printf '%s\n' "${owner_rows[@]}"
  echo
  echo "Local checks do not establish deployment evidence."
} > "$report_tmp" || { echo "Failed to write report: $report_tmp" >&2; exit 1; }
chmod 0600 "$report_tmp" || { echo "Failed to secure report: $report_tmp" >&2; exit 1; }
mv -f "$report_tmp" "$REPORT_FILE" || { echo "Failed to publish report: $REPORT_FILE" >&2; exit 1; }
trap - EXIT INT TERM

echo "Phase 3 report: $REPORT_FILE"
echo "Phase 3 result: $([[ $failures -eq 0 ]] && echo PASS || echo FAIL)"
[[ $failures -eq 0 ]]
