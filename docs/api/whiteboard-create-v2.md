# Create whiteboard — v2

`POST /api/v2/editor/space/{spaceId}/whiteboard/create`

Creates a whiteboard in the new `whiteboard` schema. Apply `db/beskar/updates/whiteboard_creation.xml` through the main Liquibase changelog before enabling this endpoint. New whiteboards created by the UI use v2. Existing legacy boards continue using the v1 editor. Draft retrieval, incremental saves, publication and title changes are documented separately. See [UI integration decisions](whiteboard-ui-v2-decisions.md).

## Request

Use the application's existing authenticated cookie or bearer session.

```http
POST /api/v2/editor/space/c7022348-1bb3-4e52-8403-17786e15e035/whiteboard/create
Content-Type: application/json
Idempotency-Key: 0195ad23-831a-7000-8000-000000000001

{
  "title": "Architecture discussion",
  "parentId": 123
}
```

- `spaceId`: nonzero UUID from the path. Do not repeat it in the body.
- `title`: required string, trimmed to 1–255 Unicode characters; null characters are rejected.
- `parentId`: optional positive JavaScript-safe integer. Omitted or null means top-level. The server verifies that a supplied parent exists in the requested space and checks page edit permission.
- `Idempotency-Key`: one nonzero UUID. Generate once for a create action and retain across retries. A separate create action needs a new key.
- Maximum JSON body: 16 KiB. Unknown fields, invalid UTF-8, and trailing JSON are rejected. Actor identity comes from authentication.

## Success, including successful replay

```http
HTTP/1.1 201 Created
Content-Type: application/json
```

```json
{
  "status": "success",
  "data": {
    "pageId": 42,
    "spaceId": "c7022348-1bb3-4e52-8403-17786e15e035"
  }
}
```

The receipt contains the request hash and created page ID, not a copy of the response or snapshot. Returning stable IDs makes replay independent of subsequent edits. Creation currently returns no Location header. Use the returned IDs with the [v2 draft manifest](whiteboard-draft-v2.md); the legacy v1 edit endpoint cannot read this content.

## Persistence and retries

The handler checks space `edit_page` permission and, for a nested board, parent `edit` permission. Every attempt, including a replay, is authorized for the current caller.

In a READ COMMITTED transaction, the service takes a transaction-scoped advisory lock on the actor/space/key identity and checks the receipt. Identical requests return the recorded page ID without allocating a page. Different content under the same scoped key returns 409. The receipt primary key remains the database uniqueness guard.

The transaction sets `SET LOCAL lock_timeout = '3s'` before acquiring locks. Each lock acquisition may wait up to three seconds; this is not a total request deadline. A lock timeout rolls back the transaction and returns 503 `WHITEBOARD_CREATE_BUSY` with `Retry-After: 1`. Retry with the same request and idempotency key. The setting resets when the transaction ends and does not leak into pooled connections.

For a new request, it locks and validates the space (not deleted or archived), verifies the parent's space membership under a row lock, and writes:

1. `core.page`, with type `whiteboard`, authenticated owner, and parent.
2. `whiteboard.whiteboard`, with original creator and a null publication pointer.
3. `whiteboard.whiteboard_snapshot`, through sequence zero, with title and initial state digest.
4. `whiteboard.whiteboard_draft`, pointing to that snapshot at head sequence zero.
5. `whiteboard.whiteboard_create_receipt`, keyed by actor, space, and idempotency key.

All five writes commit together. The initial state is the canonical empty Yjs update-v1 bytes `00 00`; the initial title is stored in snapshot metadata. The create endpoint does not encode drawing-package internals or create legacy `page_doc_map` rows. Later renames use the checkpoint title field; see [title changes](whiteboard-title-v2.md).

After commit, the service writes the page-to-space relationship in Permify with a five-second request timeout. The controller reports 201 only after the service succeeds. On a permission-provisioning failure it returns 503 with `Retry-After: 1`; retry the same request and key. The receipt survives, and the retry repeats provisioning for the existing page without creating another board.

This is synchronous provisioning with retry repair, not a background reconciliation worker. If a client abandons creation after a failed provisioning response, a committed board can remain without its Permify relationship until the request is retried or operationally repaired. PostgreSQL and Permify do not share a transaction. Permission revocation can also cause a later retry to be denied.

## Error contract

```json
{
  "status": "FAILED",
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "idempotency key was reused with different content"
  }
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Invalid identity header, space ID, or request body |
| 401 | `UNAUTHENTICATED` | Missing or invalid application identity |
| 403 | `CREATE_WHITEBOARD_FORBIDDEN` | Space or parent edit permission denied |
| 404 | `SPACE_OR_PARENT_NOT_FOUND` | Missing/deleted space, missing parent, or parent in another space after authorization |
| 409 | `SPACE_ARCHIVED` | New creation is forbidden in the archived space |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Existing scoped key has a different normalized request hash |
| 413 | `REQUEST_TOO_LARGE` | Body exceeds 16 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Request is not application/json |
| 500 | `WHITEBOARD_CREATE_FAILED` | Database operation or commit could not be confirmed; retry the same key |
| 503 | `WHITEBOARD_CREATE_BUSY` | Lock wait timed out; retry the same request and key |
| 503 | `WHITEBOARD_PERMISSIONS_PENDING` | Creation is committed but permission setup must be retried |

Authentication/authorization may reject requests before resource existence is disclosed. A matching committed receipt is replayed before checking mutable-space state, because replay does not create another board.

## Implementation files

Under `server/editor/`:

- `whiteboardControllerV2.go`: routing, request parsing, authorization, and HTTP error mapping; calls `service.CreateWhiteboard`.
- `whiteboardServiceV2.go`: configured database/permission dependencies, transaction, request hashing, idempotent replay, and permission provisioning.
- `whiteboardValidationsV2.go`: request validation and normalization.
- `whiteboardQueriesV2.go`: SQL for the v2 creation flow; shared page insertion reuses `newPageWithType` from `queries.go`.
- `whiteboardTypesV2.go`: request body, service input, and result types.

Controller, service, and validation tests are in their corresponding `_test.go` files. Service tests cover transaction failures, receipt replay, provisioning retries, and cancellation independently of HTTP.
