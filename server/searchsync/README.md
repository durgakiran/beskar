# Published-document search synchronization

`searchsync` maintains a derived `public.documents` table in a separate PostgreSQL
`search` database. It uses the existing `searchtext` extractor; the search record
contains `spaceId`, `createdBy`, `pageId`, `docId`, `title`, `bodyText`, `createdAt`,
and `updatedAt`. Publication metadata and node arrays come from one source SELECT.
Title-only publications have an empty body. Draft content is never a fallback.

## Code structure

- `queries.go` defines SQL statements, following the other server packages.
- `repository.go` executes statements and scans results using the supplied pool,
  transaction, or physical connection.
- `outbox.go` validates producer requests and controls capture enablement.
- `worker.go` orchestrates extraction, retries, transactions, and leadership.
- `database.go` configures the target connection pool.
- `cmd/searchsync` handles maintenance modes and output through package operations.

Transaction ownership stays with the caller. Repository operations never acquire
another connection, so producer writes share the source transaction and worker
writes stay on the target session holding the advisory lock.

## Transaction and failure behavior

The editor's create, publish and delete transactions append a page ID to
`search_sync.outbox`. Space archive, unarchive and soft-delete transactions append
all affected document page IDs. Capture errors fail the source mutation, ensuring
that an enabled producer cannot commit an unrecorded change. Draft saves and page
reordering do not enqueue work because they do not change the search document.

`outbox.reason_id` and `outbox.status_id` are SMALLINT foreign keys to
`search_sync.reasons` and `search_sync.statuses`. Lookup IDs are stable and seeded
by separate Liquibase changesets; Go uses typed constants in `catalog.go`. The app
role has SELECT-only access to these catalogs. Add new reasons/statuses through
migrations before deploying code that uses them. CLI status output joins the
status catalog to keep names readable.

Events contain refresh instructions, not document snapshots. A worker selects the
current eligible publication or deletes the target row when the page is absent,
unpublished, archived or deleted. An event delayed by retries therefore uses the
current publication. The outbox has no page foreign key, so events survive page
and publication deletion. Direct SQL changes and new mutation paths must enqueue
an event explicitly; use backfill/reconcile after maintenance outside the app.

Each event holds a source row lock within a bounded transaction. The target
upsert/delete commits before the source event is acknowledged. Failure between
those commits can replay the target write; writes are idempotent by `page_id`.
Delivery is at least once. `next_attempt_at` determines when an event is eligible:
new events default to now, failures defer the next attempt, and manual replay
resets it to now. Events use capped exponential retries and become
`failed` after the configured maximum attempts. A failed extraction preserves the
previous target row until repaired and retried or superseded by a later event.

A target session advisory lock permits one writer across application instances.
Every target write uses that physical connection. On connection loss the batch
ends, and the next batch obtains leadership and rereads the source. Configure the
target through PostgreSQL directly or session pooling: transaction-pooling proxies
are incompatible with this session-lock protocol. Allow only this worker to write
the search table. The worker is eventually consistent; search results must still
be authorized against application permissions before exposing content.

## Migrations and rollout

Both flags default to `false`. No running database is automatically provisioned by
the Go worker. The migration files added here have not been applied to the running
development database.

1. Apply the normal application Liquibase changelog, `db/beskar/update.xml`.
   It includes `updates/search_sync.xml` and grants outbox access to `${app_user}`.
2. Configure `DB_SEARCH_NAME` (default `search`), `DB_SEARCH_WRITER_USER`
   (default `search_writer`), and `DB_SEARCH_WRITER_USER_PWD` in the deployment
   env file. The `db-init` job applies `db/init/search.xml` through the root
   connection to create the database, writer role, and CONNECT grant. It then
   applies `db/search/update.xml` in the search database with root migration
   credentials, granting schema USAGE and document DML to the runtime writer.
   Existing roles are preserved; changing the env password does not rotate them.
3. For manual migrations, apply `db/init/search.xml` through the root database
   first, then `db/search/update.xml` against **search** with Liquibase changelog
   parameter `search_writer` set to the writer role name. The entrypoint includes
   `updates/extensions.xml` and `updates/documents.xml`. Each extension, the table,
   each index, and the writer grants have separate changesets and rollbacks.
   Use an administrative migration connection. This creates pgvector in public before pg_search, then
   creates documents and its ParadeDB index and grants only runtime table DML.
   PostgreSQL must have pg_search preloaded (the Debian Compose service does).
   These migrations target pg_search 0.26.3 / PostgreSQL 16.
4. Set these values in the deployment's **source env file**, then render/redeploy
   the server using the normal deployment scripts. Both Compose templates forward
   the values; do not edit the generated Compose file.

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

   Capture can be enabled first while the worker is disabled. Once enabled,
   capture requires the source migration. Worker target failures do not block
   publication; events accumulate for retry. Use the appropriate
   `PG_SEARCH_SSLMODE` for the deployment. Search credentials
   are raw values and must not be URL encoded. Docker defaults the target settings
   to `DB_HOST`, `DB_PORT`, `DB_SEARCH_NAME`, `DB_SEARCH_WRITER_USER`, and
   `DB_SEARCH_WRITER_USER_PWD`; explicit `PG_SEARCH_*` values override them.
5. Run backfill after **all** application instances capture events; run reconcile
   too if reusing a target that may have orphaned rows. Watch pending/failed counts
   while the worker drains the queue. Backfill is restartable and may duplicate
   refresh events safely. It does not clear or truncate existing search records.

Worker defaults (these settings use the `SEARCH_SYNC_` prefix):

| Setting | Default |
| --- | --- |
| CAPTURE_ENABLED | false |
| WORKER_ENABLED | false |
| POLL_INTERVAL | 1s |
| TRANSACTION_TIMEOUT | 30s per event or connection acquisition |
| BATCH_SIZE | 25 |
| MAX_ATTEMPTS | 10 |
| RETRY_INITIAL | 1s |
| RETRY_MAX | 5m |

## Operating commands

See the [searchsync command README](../cmd/searchsync/README.md) for a mode guide,
configuration reference, and operating examples.

From `server/`, provide `DATABASE_URL` for the **source app database**, or use the
application's `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USER`, and `PG_PASSWORD` variables.
An explicit `DATABASE_URL` overrides `PG_*`. Configure the separate **search**
target using `PG_SEARCH_HOST`, `PG_SEARCH_PORT`, `PG_SEARCH_DB`,
`PG_SEARCH_USER`, and `PG_SEARCH_PASSWORD`. Optional `PG_SEARCH_SSLMODE` controls
TLS; pgx defaults to `prefer`. Target host, port, database, and user are required
when the worker or explicit target access is enabled. Docker commands can
use the server container's existing source and target settings directly.
The CLI never loads dotenv files automatically. Connection credentials should
not be printed or committed. Source credentials need source SELECT plus outbox INSERT/UPDATE and
sequence USAGE; target credentials need documents DML. Runtime grants are in the
changelogs. Use the corresponding role credentials for each connection.

```sh
# Read counts and oldest event timestamp by state (default operation).
go run ./cmd/searchsync -mode status

# Queue current source page IDs in bounded transactions.
go run ./cmd/searchsync -mode backfill

# Queue existing target IDs too: orphaned target rows will be removed by worker.
go run ./cmd/searchsync -mode reconcile

# Process one batch explicitly, even when the background worker flag is false.
go run ./cmd/searchsync -mode once

# Repair the underlying problem before resetting failed events for retry.
go run ./cmd/searchsync -mode replay-failed
```

`once` exits successfully if another worker holds leadership; inspect `Leader` and
`Processed` in its JSON output. Backfill and reconcile enqueue events; an enabled
worker or subsequent `once` calls perform target writes. Worker logs contain event
IDs, page IDs, counts and safe error categories, never document bodies or DSNs.
Monitor pending age, failed events and target connectivity; this is an internal
worker and does not add a public search endpoint.

Completed events are retained for diagnosis. After your chosen audit window, an
administrator can delete completed rows in bounded batches; do not delete pending
or failed work. To pause delivery while retaining changes, disable only the worker.
If capture is disabled while users write, run backfill plus reconcile before
relying on search again. To rebuild, provision an empty target schema, keep capture
on and backfill; source publication data remains authoritative.

## Verification

```sh
go test -race ./searchsync ./searchtext ./editor ./space ./cmd/searchsync

# Explicit opt-in: creates/drops uniquely named test databases on this server.
# Point ONLY at a disposable PostgreSQL 16 installation with pg_search preloaded.
SEARCH_SYNC_TEST_DATABASE_URL="$DISPOSABLE_POSTGRES_URL" go test -race ./searchsync -run TestWorkerIntegration -v
```

The integration test runs the actual XML changelogs through Liquibase (available
on PATH, or set `LIQUIBASE_BIN`) and checks transactional
capture, title-only creation, draft exclusion, latest-state updates, real lexical
queries, duplicate delivery, singleton/concurrent workers, target-session loss,
acknowledgement failure after target commit, capped retries, archive rollback,
archive/unarchive, backfill, and deletion with cascading source records.
