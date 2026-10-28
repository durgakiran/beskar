# documentbodytext

Generate JSONL search documents from published document nodes in the application
PostgreSQL database or a previously exported JSONL file. Each output record
contains publication metadata and extracted `bodyText`.

The command reads source data only. It does not populate the search database,
create outbox events, publish documents, or run migrations.

## Build

Run the following commands from the repository root:

```bash
cd server
go build -o /private/tmp/documentbodytext ./cmd/documentbodytext
```

All examples below assume you are in the `server` directory. Go 1.25 or newer is
required by the server module. You can also use `go run ./cmd/documentbodytext`
in place of `/private/tmp/documentbodytext`.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `--page-id` | `0` | Select one page ID. Zero selects all eligible publications. Negative IDs are rejected. |
| `--input` | Unset | Read a published-node JSONL export. Use `-` for stdin. When unset, connect using `DATABASE_URL`. |
| `--output` | Unset | Create a new JSONL file. When unset, write to stdout. |
| `--export-sql` | `false` | Print a read-only SQL export script without connecting to PostgreSQL or generating documents. |

Set `DATABASE_URL` to the **application database**, usually `beskar`, rather than
the derived `search` database. It is required only for direct database reads;
`--input` and `--export-sql` work without it. The command does not load `.env`
files automatically.

## Read directly from PostgreSQL

Export your source connection URL in the shell. URL-encode special characters in
the username and password, and use the TLS settings appropriate to the deployment:

```bash
export DATABASE_URL='postgres://READER:URL_ENCODED_PASSWORD@localhost:5433/beskar?sslmode=disable'

# Generate one published document.
/private/tmp/documentbodytext --page-id 139 --output /private/tmp/page-139.jsonl

# Generate every eligible publication.
/private/tmp/documentbodytext --output /private/tmp/published-bodies.jsonl

# Write JSONL to stdout instead of creating a file.
/private/tmp/documentbodytext --page-id 139
```

The reader needs SELECT access to `core.page`, `core.space`, `core.page_doc_map`,
`core.content`, and `core.text_node`, plus USAGE on schema `core`. Reads use a
read-only repeatable-read transaction with a five-minute overall timeout.

Database selection includes document pages in spaces that are neither archived
nor deleted. For each page, it selects the latest published version (`draft=0`),
ordered by `version DESC, doc_id DESC`. Draft bodies are never a fallback.

## Read through Docker without exposing a database port

Generate a SQL script, execute it inside the PostgreSQL container, and feed its
JSONL output into the generator:

```bash
set -o pipefail
/private/tmp/documentbodytext --export-sql --page-id 139 |
  docker compose -f ../docker/.generated/compose.yml -p beskar-dev \
    exec -T postgres psql -X -qAt -v ON_ERROR_STOP=1 -U admin -d beskar |
  /private/tmp/documentbodytext --input - --output /private/tmp/docker-page-139.jsonl
```

Replace `beskar-dev`, `admin`, and `beskar` with your Compose project, database
role, and application database name. PostgreSQL authentication must already be
configured for the `psql` invocation. Omit `--page-id` on the export command to
select every eligible publication. `pipefail` makes upstream export failures
fail the pipeline too.

`--export-sql` prints a transaction containing `BEGIN READ ONLY`, a UTC timezone
setting, the publication SELECT, and `COMMIT`. To inspect or save it separately:

```bash
/private/tmp/documentbodytext --export-sql --page-id 139 \
  --output /private/tmp/export-page-139.sql
```

## Generate from a saved export

```bash
/private/tmp/documentbodytext --input /private/tmp/published-nodes.jsonl \
  --output /private/tmp/generated-bodies.jsonl

# Filter an existing export to one page.
/private/tmp/documentbodytext --input /private/tmp/published-nodes.jsonl \
  --page-id 139 --output /private/tmp/filtered-page-139.jsonl
```

Input records must follow the published-node export format: publication metadata
plus `content` and `text` arrays. Generate this format using `--export-sql`; the
command's generated search documents are a different format and should not be
used as node input. Offline input is trusted as a publication export; eligibility
and latest-version selection happen in the database export query.

## Output and failures

Output contains one JSON object per line with these fields:

```json
{"spaceId":"00000000-0000-0000-0000-000000000090","createdBy":"00000000-0000-0000-0000-000000000091","pageId":139,"title":"Example","createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-02T00:00:00Z","docId":209,"bodyText":"Hello database"}
```

Timestamps are UTC publication metadata, not generation timestamps. Title-only
publications with no content or text rows produce an empty `bodyText`. Nonempty,
malformed trees fail extraction. See the [extractor documentation](../../searchtext/README.md)
for supported node behavior and limits.

JSONL goes to stdout or `--output`; diagnostics and the generation summary go to
stderr:

```text
Generated 33 documents; 0 failed.
```

- Exit status is zero when at least one matching document is generated and none
  fail. SQL export mode exits zero when the script is written successfully.
- Extraction failures are reported with page/document IDs. Processing continues,
  successful records are retained, and the command exits nonzero at the end.
- Invalid JSON, input decoding errors, database errors, and output errors stop
  processing. No matching publications also produces a nonzero exit status.

Always check the exit status: output can be partial or empty after a failure.
Output files are created with permissions `0600`, and existing files are never
overwritten. Choose a new filename for each run. Exported input and generated
bodies contain user content; keep them outside Git.

## Verify the command

```bash
go test ./searchtext ./cmd/documentbodytext
```
