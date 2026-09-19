# Shared page listing and navigation

The existing discovery endpoints support both legacy content and v2 whiteboards:

| Endpoint | Result |
| --- | --- |
| `GET /api/v1/space/{spaceId}/page/list` | Accessible pages, titles, hierarchy and navigation metadata |
| `GET /api/v1/editor/space/{spaceId}/page/{pageId}/metadata` | Content type, API version and navigation metadata |
| `GET /api/v1/editor/space/{spaceId}/page/{pageId}/inline-link` | Title and navigation metadata for an inline link |

Responses retain the existing `status` / `data` envelope. All three add `contentApiVersion` (`1` for legacy content, `2` for v2 whiteboards), `canEdit`, an optional `publishedVersionId`, and a `whiteboard` object for v2 boards:

```json
{
  "contentApiVersion": 2,
  "type": "whiteboard",
  "canEdit": true,
  "publishedVersionId": "f73f233c-0e67-4e84-a9e9-7e3ee6d970fa",
  "whiteboard": {
    "draftUrl": "/api/v2/editor/space/09b4a7b3-eaad-4df9-86b5-95e3c48190cb/whiteboard/42/draft",
    "publishedUrl": "/api/v2/editor/space/09b4a7b3-eaad-4df9-86b5-95e3c48190cb/whiteboard/42/published",
    "previewUrl": "/api/v2/editor/space/09b4a7b3-eaad-4df9-86b5-95e3c48190cb/whiteboard/42/published/f73f233c-0e67-4e84-a9e9-7e3ee6d970fa/preview"
  }
}
```

This fragment shows the common fields; each endpoint retains its existing fields. These URLs retrieve content; browser routes remain an independent frontend concern. Clients can branch on `contentApiVersion` to choose the content loader. The preview URL returns the published PNG and is pinned to the listed version. The published URL returns the current manifest; append `?preview=true` to retrieve its current PNG.

`draftUrl` is supplied only to editors. Published URLs and `publishedVersionId` are omitted until publication; `previewUrl` is omitted if that version has no preview. Legacy pages omit the `whiteboard` object. Existing `previewAssetName` retains its legacy meaning; v2 clients should use `whiteboard.previewUrl`.

Listings require page-level view access and are scoped to the requested space. Unpublished v2 boards appear only for editors. Deleted spaces are excluded. Archived spaces remain readable under existing page permissions. Editors see the latest checkpoint title; other viewers see the published title. Existing breadcrumbs use the same title selection. Root pages have `parentId: 0` in listings.

No additional Liquibase changeset is needed for discovery. The existing XML changesets for v2 creation, checkpoints, publication, previews and titles must already be applied. Frontend adoption of the v2 loader is separate from these shared API changes.

For v2 boards, listing `draft: 1` means an editor has unpublished content (no publication or a draft head newer than the published snapshot). `draft: 0` opens the lightweight published view when the current draft is fully published.
