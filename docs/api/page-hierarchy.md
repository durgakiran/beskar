# Page moving and shared sibling ordering

These v1 endpoints apply to documents, legacy whiteboards, and v2 whiteboards. They change page hierarchy and navigation order; content APIs and page IDs remain unchanged.

| Endpoint | Operation |
| --- | --- |
| `PUT /api/v1/space/{spaceId}/page/{pageId}/parent` | Move a page and its subtree under another parent or to the space root |
| `PUT /api/v1/space/{spaceId}/page/{pageId}/order` | Place a page before or after another page with the same parent |
| `GET /api/v1/space/{spaceId}/page/list` | Read accessible pages in the saved shared order |

Use the existing authenticated browser session or bearer-token authentication. Send `Content-Type: application/json`. Space IDs are UUIDs; page IDs and non-null parent IDs are positive JavaScript-safe integers (`1` through `9007199254740991`). Each write accepts one JSON object of at most 1024 bytes. Unknown fields and additional JSON values are rejected. Neither endpoint requires an `Idempotency-Key` or accepts client-generated sort keys.

## Move a page

```http
PUT /api/v1/space/09b4a7b3-eaad-4df9-86b5-95e3c48190cb/page/42/parent
Content-Type: application/json

{"parentId": 17}
```

To place the page beside a page in another branch, supply an anchor and placement together:

```json
{"parentId": 17, "targetPageId": 51, "placement": "before"}
```

Page 51 must currently belong under page 17. The parent change and the before/after placement are saved in one transaction. For a root sibling, use `parentId: null`. `targetPageId` must be a different positive JavaScript-safe page ID, and `placement` must be `"before"` or `"after"`. Supplying only one of these fields, or null for either anchor field, is invalid. A target that has left the supplied parent returns 409; refresh before retrying.

`parentId` is required. Use `{"parentId": null}` for the space root; omitting the field or sending `0` or `-1` is invalid.

The caller needs space `view` and source-page `edit` permission. Moving under a page additionally requires destination-page `edit`; moving to the root requires space `edit_page` permission. An anchored move also requires anchor-page `edit` permission. The source and destination must belong to the requested space. A page cannot contain itself or be moved under any of its descendants.

Without an anchor, a parent change appends the page after the destination's existing children. With an anchor, it inserts the page immediately before/after that target. Only the source page's parent and rank are updated. Its descendants retain their parent relationships and relative order. Moving to the current parent without an anchor succeeds without updating a row; an anchored same-parent request may change its rank.

HTTP 200:

```json
{
  "status": "success",
  "data": {"pageId": 42, "parentId": 17}
}
```

A root move returns `parentId: null`. The [listing endpoint](page-navigation.md) retains its existing database parent representation, where root pages can have `parentId: 0` or `parentId: -1`. Treat nonpositive listing parent IDs as the root.

## Reorder siblings

```http
PUT /api/v1/space/09b4a7b3-eaad-4df9-86b5-95e3c48190cb/page/42/order
Content-Type: application/json

{"targetPageId": 51, "placement": "before"}
```

Both fields are required. `placement` is exactly `"before"` or `"after"`. The target must be a different page in the same space and with the same parent as the source. Root pages form one sibling group regardless of the existing null/zero/negative root marker.

The caller needs space `edit_page` and both source- and target-page `edit` permission. The server determines the actual destination neighbours, including siblings omitted from the caller's listing. Other siblings retain their relative order.

HTTP 200:

```json
{
  "status": "success",
  "data": {"reordered": true}
}
```

A changed order updates only the source page's rank. An already satisfied placement succeeds without updating any row. The parent is unchanged; cross-parent drag-and-drop must use the move endpoint instead.

The saved order is shared by every viewer of the space, rather than stored per user. Refresh the page listing after a successful write, and refresh other open clients when they need the latest order; these endpoints do not broadcast changes. The response does not include the list or a sort key.

## Sidebar drag-and-drop

The sidebar uses the target row's top quarter for `before`, middle half for moving `inside`, and bottom quarter for `after`. Edge zones display an insertion line. The middle zone outlines the row and labels it “Move inside”.

- A middle drop sends a move request with the target as `parentId`, appending the source under that page.
- An edge drop among existing siblings uses the reorder endpoint.
- An edge drop across parents sends one anchored move request with the target's parent and the target's ID. The parent and rank cannot partially succeed.

Self and descendant targets are rejected for all drop zones; dropping beside an ancestor can promote a child out of its current parent. Read-only destinations and external drags are ignored. A single child still has a drag handle when tree moves are enabled. A successful inside drop expands the destination, and existing keyboard sibling ordering remains available.

## Reading the shared order

The page listing is flat and ordered by the internal rank, with page ID as a deterministic tie-breaker. Group pages by parent to build a tree, preserving the relative order of each sibling group's entries. Different groups may interleave in the flat response; it is not a depth-first traversal. Do not sort the returned siblings again by ID or title.

`sort_key` and the retired `sort_position` are storage details and are not fields in the listing or write contracts. Existing access filtering and whiteboard draft/publication visibility still apply.

## Errors and conflict handling

Errors use the existing v1 envelope. `error.code` is numeric; handler-generated failures place the explanation in `error.detail`, while `error.message` is `"FAILED"`. Authentication middleware may instead use `error.message: "Not authenticated"` and omit `detail`.

Example HTTP 409:

```json
{
  "status": "FAILED",
  "error": {
    "code": 13,
    "message": "FAILED",
    "detail": "Page hierarchy changed concurrently. Refresh and try again"
  }
}
```

| HTTP | Meaning |
| --- | --- |
| 400 | Invalid IDs, malformed/oversized JSON, missing fields, unsupported placement, or self-targeting. Move also rejects a destination outside the space or a descendant cycle. The 1024-byte body limit returns 400, not 413. |
| 401 | Authentication middleware could not obtain a user identity. |
| 403 | Caller lacks the required permission or the existing space is archived/deleted. |
| 404 | Requested space or source page is missing. Both writes also use 404 for an anchor/target not found in the requested space. Permissions are checked first and may produce 403 before existence checks. |
| 409 | Serializable transaction conflict, deadlock, one-second row-lock timeout, duplicate sibling rank, exhausted rank length, a reorder target that is no longer a sibling, or a move anchor whose parent no longer matches the supplied destination. |
| 500 | Other database/internal failures. |

After a concurrency or stale-parent 409, refresh the listing and let the user retry against the current tree. The server makes one attempt and does not automatically replay conflicts. On a lost acknowledgement, refresh before deciding whether another request is necessary; there is no stored idempotency receipt. A rank-exhaustion 409 needs ordering maintenance, rather than repeated submission into the same gap.

## Rank storage and transactions

`core.page.sort_key` is `TEXT COLLATE "C"`. The alphabet is Base62 (`0-9`, `A-Z`, `a-z`); keys use the fractional-indexing integer-head/fractional-suffix format, not ordinary Base62 numeric comparison. Go's pinned `roci.dev/fracdex` dependency generates a key between the destination neighbours. Keys are limited to 256 characters; automatic rebalancing is not implemented.

Moves and reorders run in `SERIALIZABLE` transactions. They read the space lifecycle state without an explicit space-row or advisory lock, then read source/destination hierarchy and rank bounds. Only the moved page is updated. PostgreSQL serialization failures, deadlocks, lock timeouts, and the sibling-rank unique-index collision map to 409; transaction commit errors are checked as well. This prevents concurrent opposite parent moves from committing a cycle.

`SET LOCAL lock_timeout = '1s'` bounds individual lock acquisitions, not the total request duration. A normal page update still takes its own row lock. Space archival is not pinned by a shared space-row lock, so a move/order request already in progress may finish while an overlapping archive operation completes.

## Migration and page creation

Apply the normal `db/beskar/update.xml` Liquibase changelog before starting the updated API. It includes, in order:

1. `updates/page_ordering.xml`: the original integer-position column and index.
2. `updates/page_fractional_ordering.xml`: the Base62 column, backfill, uniqueness constraint, and page-creation trigger.

The follow-up migration preserves previously saved sibling order by numbering each `(space, normalized parent)` group using `sort_position NULLS LAST, id`, then encoding each ordinal with `core.page_sort_key_from_integer`. Examples: `1 -> a1`, `61 -> az`, `62 -> b10`.

A `BEFORE INSERT` trigger assigns omitted ranks for existing document and whiteboard creation paths. It finds the last sibling, chooses the next integer rank, and appends an encoded page-ID suffix plus `V`. The suffix distinguishes concurrent creations without locking the space or rewriting sibling rows. New pages append; the caller does not supply a rank. The unique index scopes ranks to space and normalized parent.

The migration's backfill is the one-time bulk update. Normal moves and reorders do not renumber siblings. The old position column remains for rollback; rollback first derives integer positions from the current Base62 order, preserving the then-current order.

## Implementation and verification

- `server/space/space.go`: routes, authentication, authorization, and HTTP errors.
- `server/space/validations.go` and `types.go`: request validation and contract types.
- `server/space/spaceService.go`: transactions, neighbour lookup, rank generation, and conflict classification.
- `server/space/queries.go`: page reads and single-row writes.
- `server/apidocs/openapi.json`: the embedded interactive API contract.
- `server/space/pageOrder_test.go`, `validations_test.go`, and `pageOrder_integration_test.go`: rank, validation, migration, single-row update, and concurrent-conflict checks.

Run unit tests from `server/` with `go test ./space ./apidocs`. The PostgreSQL suite is opt-in: set `PAGE_ORDER_TEST_DSN` to a disposable database named exactly `page_order_test` and run `go test ./space -run TestPageFractionalOrderingPostgres -count=1 -v`. That integration test drops/recreates its `core` schema and must not target application data.
