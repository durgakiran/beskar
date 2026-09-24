# Phase 3 Rollout, Security, and Coverage Gate

This gate implements P3-C7 and roadmap section 6.3. It is evidence collection, not deployment evidence. Local success never changes an environment-owned item to `supplied`.

## Run the gate

Copy `docs/runbooks/phase-3-rollout-evidence.tsv` outside the repository evidence template if it will contain restricted links. Keep the header and gate IDs unchanged. For each row use exactly one status:

- `required`: evidence has not been reviewed yet.
- `supplied`: a named owner supplied reviewable passing evidence with an independent reviewer.
- `blocking`: the owner supplied reviewed failing evidence and a blocker note.

Every `supplied` or `blocking` row must contain a non-placeholder owner and reviewer, environment identifier, lowercase `sha256:` build/image digest, descriptive procedure, matching `pass`/`fail` result, RFC3339 UTC timestamp, and credential-free HTTPS artifact URL. `required` rows use `UNASSIGNED` and leave those evidence fields empty. Values such as `Nobody`, `unknown`, malformed URLs, and free-form timestamps are rejected.

Run the repeatable verifier:

```bash
./docker/scripts/verify-phase-3-rollout.sh \
  --evidence docs/runbooks/phase-3-rollout-evidence.tsv \
  --report /tmp/phase-3-rollout-report.md
```

The command is non-destructive. It writes only the requested report and temporary coverage files. It exits nonzero when a local check fails, owner evidence is missing/blocking, the browser topology is absent, or the evidence file is malformed.

Set `P3_RUN_EPHEMERAL=1` to include the migration/storage/quota/cleanup/restore topology test. Set `P3_RUN_BROWSER_SECURITY=1` to include the deployed browser corpus. Both modes fail closed if their required configuration is incomplete.

## Local automated evidence

The verifier runs these checks without claiming anything about a deployment:

| Check | Command or assertion |
| --- | --- |
| Migration wiring | Parses `db/beskar/update.xml` and `db/beskar/updates/whiteboard_assets.xml`; verifies the include, table, page/hash primary key, storage-key uniqueness, and page cascade. |
| Server security tests | `go test ./media/services ./media/controller ./storage ./quota` from `server/`. |
| Phase-owned TypeScript coverage | The Glideline and Glideboard `test:phase3:coverage` scripts enforce 90% statements, branches, functions, and lines per owned file for ingress, asset rendering, generic placement, import UI, and asset-library modules. Reports are written under `/tmp`, not the source tree. |
| Phase-owned Go coverage | `./docker/scripts/test-phase-3-go-coverage.sh`; 90% statements for the dedicated whiteboard asset service. Go does not expose separate branch/function/line threshold dimensions, so this is supplemental to the four-dimensional Vitest gate. |
| Ephemeral topology | `./docker/scripts/test-phase-3-ephemeral.sh`; repository-owned probes directly verify the migration contract, disposable database, S3-compatible storage/dedupe/cleanup behavior, quota modes, and database restore, then emit fixed-schema JSON. It accepts no caller commands or result JSON. |
| Browser security | `npm --prefix packages/glideboard run test:e2e:phase3-security`; waits for terminal malicious-SVG rejection and network settlement, then proves distinct authenticated tenants and tenant-B fixture readability before checking tenant-A denial. |

The complete production surface is enumerated in `phase-3-coverage-manifest.json`, including shared controller/UI asset paths, portability, demo storage, and the production host adapter. Dedicated Phase 3 modules and shared files are included in coverage runs; a failing per-file threshold remains a gate failure rather than being excluded.

## Ephemeral topology contract

The environment-owned topology harness must provision unique resources, run its assertions, clean up only those resources, and emit a schema-version `1` JSON result plus a SHA-256 sidecar. Pass both files to the owned validator:

```env
P3_EPHEMERAL_RESULT_FILE=/secure/results/phase3-ephemeral.json
P3_EPHEMERAL_RESULT_SHA256_FILE=/secure/results/phase3-ephemeral.json.sha256
```

The ephemeral result has a fixed repository schema and is written only after every owned probe succeeds. It is a report, not a trust input: the probe never reads caller-produced results or checksums.

## Browser topology contract

The security suite requires:

```env
P3_SECURITY_BASE_URL=https://app.example.test
P3_SECURITY_BOARD_PATH=/spaces/.../whiteboard
P3_SECURITY_TENANT_A_STORAGE_STATE=/secure/path/tenant-a.json
P3_SECURITY_TENANT_A_SUBJECT=tenant-a-user-id
P3_SECURITY_TENANT_B_STORAGE_STATE=/secure/path/tenant-b.json
P3_SECURITY_TENANT_B_SUBJECT=tenant-b-user-id
P3_SECURITY_TENANT_B_ASSET_URL=https://media.example.test/api/v1/whiteboard-asset/...
P3_SECURITY_IDENTITY_URL=https://app.example.test/api/me
P3_SECURITY_IDENTITY_SUBJECT_PATH=user.id
P3_SECURITY_MEDIA_URL_PATTERN='**/whiteboard-asset/**'
P3_SECURITY_ALLOWED_ORIGINS=https://app.example.test,https://media.example.test,https://auth.example.test
```

Use two dedicated accounts in different tenants and an existing tenant-B raster asset. The suite verifies each storage state against the identity endpoint, requires distinct expected subjects, requires tenant B to receive image bytes from the exact asset URL, and only then accepts `403`/`404` for tenant A. The malicious corpus uses repository-owned input and terminal selectors; the suite proves the upload-correlated rejection node is initially absent, waits for it and network settlement, then checks script, DOM, and request monitors. It records no credentials in the report.

## Environment and owner evidence

The TSV rows cover every roadmap 6.3 control plus adjacent Phase 3 security controls. The verifier schema-validates every supplied/blocking evidence field and rejects placeholders or malformed values. Deployment migration, object-store behavior, authorization, tenant isolation, encryption, backup/restore, retention, privacy cleanup, telemetry redaction, abuse controls, and decoder isolation remain owner evidence even when related local tests pass.

Do not commit secrets, tokens, signed URLs, storage-state files, customer identifiers, or raw telemetry to the repository.
