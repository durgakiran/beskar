# Published document body text

`Extract(DocumentNodes)` generates `bodyText` directly from persisted content
and text rows. `PublishedNodes.Generate()` adds the agreed publication metadata:
`spaceId`, `createdBy`, `pageId`, `docId`, `title`, `createdAt`, and `updatedAt`.

This package does not reconstruct Tiptap JSON, modify `jbi`, publish documents,
write a search database, or start a synchronization worker.

## Behavior

- Text and content children share one sibling-order list. SQL row order is irrelevant.
- Formatting marks add no characters or spaces. Unicode and code whitespace are preserved.
- Paragraphs/headings/note blocks concatenate inline children. Block containers use
  newlines; table rows use tabs between cells. Empty blocks/cells retain their separators.
- Mentions and status badges contribute their stored label; formulas contribute LaTeX;
  images contribute caption and alt text; attachments contribute filename; references
  and embeds contribute stored titles; dates contribute their stored value.
- Mermaid source is read from its text children, as present in the persisted corpus.
- URLs, identifiers, and remote content are not used as text fallbacks. Missing visible
  labels contribute no text. Generated table-of-contents and child-page lists are omitted.
- Unknown node types, duplicate IDs/orders, missing parents/roots, disconnected nodes,
  malformed leaf children, wrong document IDs, and invalid visible attribute types fail.
- Limits are 100,000 nodes, depth 256 (root depth zero), and 8 MiB of UTF-8 body output.
- A valid empty tree produces an empty body. At the publication-generation boundary,
  zero content rows together with zero text rows are recognized as the existing
  title-only representation and produce `bodyText: ""`. The lower-level `Extract`
  function remains strict about missing roots; orphan text and nonempty malformed
  trees are still errors. Draft content is never used as a fallback.

This validates the persisted hierarchy; it is not a full Tiptap schema validator.
Whitespace does not enforce phrase boundaries across blocks in the search tokenizer.

## Run from the server directory

See the [documentbodytext command README](../cmd/documentbodytext/README.md) for
options, database and Docker examples, and output/error handling.

```bash
go test ./searchtext ./cmd/documentbodytext
go build -o /private/tmp/documentbodytext ./cmd/documentbodytext
```

With a reachable source PostgreSQL connection, set `DATABASE_URL` in the environment
and run:

```bash
/private/tmp/documentbodytext --page-id 139 --output /private/tmp/page-139.jsonl
```

Omit `--page-id` to process every current publication in active spaces. The database
path uses a read-only repeatable-read transaction. It selects the latest `draft=0`
version by `version DESC, doc_id DESC`, and reads all its nodes in one SELECT.
Creation/creator metadata comes from the page; update time/title comes from the
selected publication. Output timestamps are UTC and are never generated from sync time.

For the local Docker database, no host port or container changes are required:

```bash
set -o pipefail
/private/tmp/documentbodytext --export-sql |
  docker compose -f ../docker/.generated/compose.yml -p beskar-dev \
    exec -T postgres psql -X -qAt -v ON_ERROR_STOP=1 -U admin -d beskar |
  /private/tmp/documentbodytext --input - --output /private/tmp/published-bodies.jsonl
```

Use `--page-id` on the export command too when selecting one page. The export is
JSONL: one publication per line, with `content` and `text` arrays. It can also be
saved to a private file and passed with `--input /absolute/path/input.jsonl`.

Output files are newly created with mode 0600; existing files are never overwritten.
Bodies are private user content: keep exported input and output out of Git.

Each successfully generated document is emitted to the JSONL output. Extraction
failures are reported to stderr with page/document identifiers and no document body.
The command continues after extraction failures and exits nonzero if any failed or
no documents matched. Therefore output can be partial: check the exit code and
summary before treating a corpus as complete. Malformed input/export decoding errors
stop the command. Only the explicit zero-content/zero-text title-only representation
is accepted without a tree; malformed nonempty input is not silently emptied.

`--export-sql` prints a read-only psql script and does not connect to PostgreSQL.
The API `ReadPublished` also accepts an existing pgx transaction/pool query interface.

## Initial real-data verification

On October 26, 2026, a read-only export contained 33 eligible published documents
(the earlier planning inventory did not filter archived spaces). The generator
produced 23 bodies. Ten publications had no content/text rows and were explicitly
reported as missing roots. Every eligible publication with stored nodes succeeded.

A subsequent [read-only investigation](../../docs/audits/document-body-missing-tree-investigation-2026-10-26.md)
classified the ten as title-only published placeholders: nine have no saved body,
while page 130 has text only in an unpublished draft. The same empty published
versions exist in the encrypted backup.

After implementing the title-only policy, a fresh read-only export generated all
33 documents with zero failures. All ten title-only records have empty bodies;
the other 23 outputs are unchanged. Page 130 remains tied to published doc 209
and excludes the saved unpublished draft text. Unit/CLI tests cover empty records,
metadata preservation, malformed-tree rejection, and no draft fallback.

For four publications with preserved published Yjs state, an independent Yjs
decoder reconstructed their original ordered trees; text extraction from those
trees exactly matched Go output: page IDs 31, 48, 49, and 139. This validates those
four snapshots, not all historical versions or a general search relevance claim.
Private exports/output remain outside the repository. The remaining structures and
malformed cases are covered by synthetic Go tests; no database fixture rows were inserted.
