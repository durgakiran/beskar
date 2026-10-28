# searchsync

Maintain the published-document search index through the application database's
`search_sync.outbox`. The command can inspect events, enqueue refreshes, replay
failures, or process one batch into `public.documents` in the search database.

It does not create databases, apply migrations, or expose a search endpoint.
See the [search synchronization README](../../searchsync/README.md) for database
setup, producer capture, transaction behavior, and deployment instructions.

## Build and configure

From the repository root:

```bash
cd server
go build -o /private/tmp/searchsync ./cmd/searchsync
```

Local command examples below assume you are in `server/`; Docker examples run
from the repository root. You can use
`go run ./cmd/searchsync` in place of `/private/tmp/searchsync`.

Provide connection settings in the shell; the command does not load `.env` files.
An explicit `DATABASE_URL` takes precedence. When it is unset or blank, the source
connection uses `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USER`, and `PG_PASSWORD`, matching
the application container:

```bash
# Source: the application database containing core tables and search_sync.outbox.
export DATABASE_URL='postgres://APP_USER:URL_ENCODED_PASSWORD@localhost:5433/beskar?sslmode=disable'

# Target: the separate search database containing public.documents.
export PG_SEARCH_HOST=localhost
export PG_SEARCH_PORT=5433
export PG_SEARCH_DB=search
export PG_SEARCH_USER=search_writer
export PG_SEARCH_PASSWORD='your-search-writer-password'
export PG_SEARCH_SSLMODE=prefer
```

For local runs, you can instead configure the source with individual values:

```bash
unset DATABASE_URL
export PG_HOST=localhost
export PG_PORT=5433
export PG_DB=beskar
export PG_USER=app_user
export PG_PASSWORD='your-password'
```

`PG_HOST`, `PG_PORT`, `PG_DB`, and `PG_USER` are required for this fallback.
`PG_PASSWORD` may be empty when database authentication permits it. Values in
`PG_*` and `PG_SEARCH_*` are used as entered; do not URL-encode these passwords.

Replace the example roles, credentials, host, port, and database names. For
connection URLs, URL-encode special characters in credentials. Choose TLS
settings for your environment.
`localhost:5433` requires PostgreSQL to be reachable on that host port; inside
Compose, use its service hostname and port, usually `postgres:5432`.

Apply the application and search migrations before using the command. Source
credentials need the SELECT and outbox INSERT/UPDATE/sequence permissions used by
the chosen mode. Target credentials need SELECT, INSERT, UPDATE, and DELETE on
`public.documents` and USAGE on schema `public`. Use the roles provisioned by the
initialization changelogs rather than root migration credentials.

## Run inside the Docker deployment

The deployment server image includes `/usr/local/bin/searchsync` on PATH. It can
run alongside the server without Go or source code in the runtime image.

Run these commands from the **repository root**. Replace `beskar-prod` with your
`COMPOSE_PROJECT_NAME` and use your deployment env file when rendering:

```bash
# Render the current deployment settings and rebuild/recreate the server.
./docker/scripts/render-configs.sh --env docker/env/prod.env
docker compose -f docker/.generated/compose.yml -p beskar-prod \
  up -d --no-deps --build server
```

Apply migrations with the deployment's `db-init` job first if they have not been
applied. Rebuilding the server alone does not run database migrations.

The server container already receives the source `PG_*` settings and the target
`PG_SEARCH_*` settings through Compose. No separate `DATABASE_URL` export or
`-e` option is needed. Commands connect through the container's configured host
and port (normally `postgres:5432`):

```bash
# Queue existing documents.
docker compose -f docker/.generated/compose.yml -p beskar-prod \
  exec -T server searchsync -mode backfill

# Inspect progress.
docker compose -f docker/.generated/compose.yml -p beskar-prod \
  exec -T server searchsync -mode status

# Process one batch manually.
docker compose -f docker/.generated/compose.yml -p beskar-prod \
  exec -T server searchsync -mode once

# Queue existing target records for refresh/removal.
docker compose -f docker/.generated/compose.yml -p beskar-prod \
  exec -T server searchsync -mode reconcile

# After repairing the cause, reset failed events for retry.
docker compose -f docker/.generated/compose.yml -p beskar-prod \
  exec -T server searchsync -mode replay-failed
```

The container inherits its source and search settings from the rendered deployment
configuration; ensure `PG_SEARCH_HOST`, `PG_SEARCH_PORT`, `PG_SEARCH_DB`,
`PG_SEARCH_USER`, and `PG_SEARCH_PASSWORD` are configured for `once` and `reconcile`.
If you explicitly set `DATABASE_URL` in the container, it overrides `PG_*`.
Backfill only queues events: enable capture on all application
instances before starting, and enable the background worker or run `once`
repeatedly to process them. If the background worker holds leadership, `once`
may process no events.

For a one-off container using the same service configuration, replace
`exec -T server` with
`run --rm --no-deps -T server`. Build the server image first.

## Modes

The only command option is `-mode`; it defaults to `status`.

| Mode | Connections used | Action |
| --- | --- | --- |
| `status` | Source | Print counts and oldest event time for each nonempty status. |
| `backfill` | Source | Queue every source document page in bounded batches. |
| `reconcile` | Source and target | Queue page IDs already present in the target for refresh or removal. |
| `replay-failed` | Source | Reset all failed events to pending, clear their error/completion fields, and reset attempts to zero. |
| `once` | Source and target | Attempt leadership and process at most one configured batch. |

`backfill`, `reconcile`, and `replay-failed` enqueue or reset work. They do not
update search documents themselves. An application background worker or subsequent
`once` calls perform those writes. Explicit CLI operations work with capture and
background-worker flags disabled. `once` and `reconcile` require
the `PG_SEARCH_*` target settings and enable target access internally.

### Inspect status

```bash
/private/tmp/searchsync -mode status
```

Example output:

```text
pending count=25 oldest=2026-10-27T08:00:00Z
completed count=100 oldest=2026-10-26T09:00:00Z
```

Times are UTC. Empty statuses are omitted; an empty outbox prints nothing.
Completed events remain in the outbox, so their count does not represent pending
work. This mode does not list individual errors or document content.

### Sync already published documents

Use this sequence to populate search from documents published before capture was
enabled. Run the commands below from `server/`.

1. Apply the source and search database migrations using the deployment's
   `db-init` job. Confirm that `search_sync.outbox` exists in the application
   database and `public.documents` exists in the search database.

2. Enable capture on **all application instances** and redeploy them before
   starting backfill, so publications and other changes during the initial sync
   are recorded:

   ```dotenv
   SEARCH_SYNC_CAPTURE_ENABLED=true
   ```

3. Configure the source connection with `DATABASE_URL` or `PG_*`, as described
   above, and queue the existing document pages. Docker commands inherit `PG_*`
   from the server service:

   ```bash
   go run ./cmd/searchsync -mode backfill
   ```

4. Configure the application to process the queued events and redeploy it:

   ```dotenv
   SEARCH_SYNC_CAPTURE_ENABLED=true
   SEARCH_SYNC_WORKER_ENABLED=true
   PG_SEARCH_HOST=postgres
   PG_SEARCH_PORT=5432
   PG_SEARCH_DB=search
   PG_SEARCH_USER=search_writer
   PG_SEARCH_PASSWORD=your-search-writer-password
   PG_SEARCH_SSLMODE=prefer
   ```

   Replace the target connection details for your environment. In Docker, empty
   search settings default to the host, port, database name, and writer credentials
   configured for `db-init`, so they need not be duplicated in the deployment env. A background
   worker may also be enabled before backfill; it will process events as they
   arrive. Each event reads the page's latest eligible published version,
   extracts its body text, and upserts the search record. Draft content is
   excluded; missing or ineligible publications cause target deletion.

   Alternatively, set the `PG_SEARCH_*` variables in your command shell and run
   `go run ./cmd/searchsync -mode once` repeatedly to process batches manually.
   Backfill itself only queues work.

5. Monitor the outbox until pending work drains and investigate any failed events:

   ```bash
   go run ./cmd/searchsync -mode status
   ```

   When writes continue, new pending events may appear. Completed events remain
   recorded, so the outbox does not need to become empty.

Progress is printed per committed batch:

```text
queued=25 through_page=139
```

Backfill enumerates source document pages, including pages whose current state
may require deletion from the target. The worker reads current publication state
when processing each event. Rerunning backfill starts again from the beginning
and can enqueue duplicate refreshes; target writes are idempotent by page ID.

If reusing an existing target, also reconcile its IDs:

```bash
/private/tmp/searchsync -mode reconcile
```

This catches target records whose source pages no longer exist. Reconcile alone
cannot discover source pages that have no target record; use backfill for those.
Neither command truncates the index.

### Process a batch manually

```bash
/private/tmp/searchsync -mode once
```

Example output:

```json
{"Processed":25,"Upserted":23,"Deleted":1,"Failed":1,"Leader":true}
```

Repeat `once` as needed, or let the application background worker drain the
queue. `SEARCH_SYNC_BATCH_SIZE` defaults to 25; `once` does not drain the entire
outbox in one invocation.

- `Leader: false` means another worker held the target session advisory lock;
  this invocation processes no events and can still exit successfully.
- `Failed` counts events whose processing failed during this batch. Such events
  can remain pending with a future retry time or reach the terminal failed state.
- An exit status of zero does not guarantee every event succeeded. Inspect the
  JSON counters and outbox status. `Processed: 0` can also mean no events are due
  yet, even when pending events exist.

Eligible publications are upserted. Missing, unpublished, archived, or deleted
pages cause target deletion. Draft content is never used as a fallback.

### Retry failed events

Repair the underlying extraction, permission, schema, or connectivity problem,
then run:

```bash
/private/tmp/searchsync -mode replay-failed
/private/tmp/searchsync -mode once
/private/tmp/searchsync -mode status
```

Replay prints `replayed=N`. It resets every terminal failed event, not a selected
page. Pending retries are not reset by this mode.

## Environment settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Empty | Optional source application connection override; takes precedence over `PG_*`. |
| `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USER` | No CLI defaults | Required source settings when `DATABASE_URL` is unset or blank. |
| `PG_PASSWORD` | Empty | Source password used with `PG_*`; may be empty if authentication permits. |
| `PG_SEARCH_HOST`, `PG_SEARCH_PORT`, `PG_SEARCH_DB`, `PG_SEARCH_USER` | No CLI defaults | Separate target settings, required when target access is enabled. |
| `PG_SEARCH_PASSWORD` | Empty | Raw target password; no URL encoding. May be empty if authentication permits. |
| `PG_SEARCH_SSLMODE` | pgx default (`prefer`) | Target TLS mode, such as `disable`, `require`, or `verify-full`. |
| `SEARCH_SYNC_BATCH_SIZE` | `25` | Maximum events per `once` batch and pages per enqueue batch; range 1–1000. |
| `SEARCH_SYNC_TRANSACTION_TIMEOUT` | `30s` | Timeout for bounded batches/events and connection operations; range 1s–5m. Status uses a fixed 30s timeout. |
| `SEARCH_SYNC_MAX_ATTEMPTS` | `10` | Attempts before an event becomes failed; range 1–100. |
| `SEARCH_SYNC_RETRY_INITIAL` | `1s` | Initial retry delay; at least 1s. |
| `SEARCH_SYNC_RETRY_MAX` | `5m` | Retry delay cap; at least the initial delay and at most 24h. |
| `SEARCH_SYNC_CAPTURE_ENABLED` | `false` | Controls application producer capture; explicit CLI enqueue operations do not require it. |
| `SEARCH_SYNC_WORKER_ENABLED` | `false` | Controls the application background worker; explicit `once` and `reconcile` enable target access themselves. |
| `SEARCH_SYNC_POLL_INTERVAL` | `1s` | Background worker poll interval; range 100ms–1h. The CLI does not poll. |

All modes validate the search configuration. If `SEARCH_SYNC_WORKER_ENABLED=true`
is set in your shell, configuration loading requires valid target settings even for
source-only modes. Source connections use `DATABASE_URL` when provided, otherwise
the application's `PG_*` settings. Database-provisioning variables such as
`DB_SEARCH_WRITER_USER_PWD` are mapped to `PG_SEARCH_*` by the deployment renderer;
they do not configure a CLI launched directly on the host. Docker defaults are
`PG_SEARCH_HOST=$DB_HOST`, `PG_SEARCH_PORT=$DB_PORT`,
`PG_SEARCH_DB=$DB_SEARCH_NAME`, `PG_SEARCH_USER=$DB_SEARCH_WRITER_USER`, and
`PG_SEARCH_PASSWORD=$DB_SEARCH_WRITER_USER_PWD`. Set individual `PG_SEARCH_*`
values to override these defaults. Password changes do not rotate existing
database roles automatically.

Failures are written to stderr and fatal errors exit nonzero. Enqueue modes can
commit earlier batches before a later failure or interruption; rerun them after
resolving the problem. A successful CLI exit does not prove the index is fully
synchronized: check pending/failed events and the worker's progress.

## Verify

```bash
go test ./searchsync ./searchtext ./cmd/searchsync
```

The database integration test requires explicit configuration; see the package
README before running it against a disposable PostgreSQL installation.
