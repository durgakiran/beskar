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

Listings require page-level view access and are scoped to the requested space. Unpublished v2 boards appear only for editors. Deleted spaces are excluded. Archived spaces remain readable under existing page permissions. Editors see the latest checkpoint title; other viewers see the published title. Existing breadcrumbs use the same title selection. Root pages can have `parentId: 0` or `parentId: -1` in listings; treat nonpositive parent IDs as the space root.

The page listing now follows the saved shared sibling order using internal Base62 ranks. Preserve each sibling group's relative response order when constructing a tree; the flat response may interleave groups. Ranks are not exposed as response fields. See [page moving and shared ordering](page-hierarchy.md) for the write endpoints, permissions, 409 handling, and migration details.

Apply the standard Liquibase changelog before using the updated listing. In addition to the existing v2 creation, checkpoint, publication, preview and title changesets, it includes `updates/page_ordering.xml` followed by `updates/page_fractional_ordering.xml`. The follow-up migration preserves saved order and supports existing page creators. Frontend adoption of the v2 loader is separate from these shared API changes.

For v2 boards, listing `draft: 1` means an editor has unpublished content (no publication or a draft head newer than the published snapshot). `draft: 0` opens the lightweight published view when the current draft is fully published.
