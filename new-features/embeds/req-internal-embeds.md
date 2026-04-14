# Specification: Internal Application Embeds (Docs & Whiteboards)

## 📝 Product Requirement
Users can embed references to other documents or whiteboards from the Beskar application, rendering as interactive, live-updating preview cards.

## 🛠️ Technical Approach
- **TipTap Extension**: Create an `InternalLinkBlock` node extension storing `resourceType` ('document' | 'whiteboard') and `resourceId`.
- **UI Components**: Render a `NodeView` fetching metadata (title, last updated, thumbnail) to display as a rich card linking externally.

## ⚠️ Corner Cases & Edge Handling
- **Deleted Resources**: If the target document is archived or deleted asynchronously on the backend, the preview card must elegantly show "Document Deleted" upon fetch rather than eternally spinning or causing network request crashes.
- **Permission Changes**: If the user viewing the editor loses read access to the linked resource, the block should obscure the preview and show a "Private: Request Access" lockout state.
- **Recursive Embryos**: Doc A embeds Doc B, which embeds Doc A. The `NodeView` metadata lookup must strictly avoid rendering deep recursive chains (limit to 1 depth flat card render) to prevent infinite React mount loops.

## 🎨 UI Design & Layout Details

- **Insertion Hooks**:
  - Add `/doc` and `/whiteboard` commands to the Slash Menu using distinct contextual icons (e.g. 📄 for docs, 🔲 for whiteboard).
  - Optionally, pasting a raw Beskar application URL automatically converts the link into this node representation.
- **Preview Card (NodeView)**:
  - Rendered similar to a Notion or Github link preview: A standalone, block-level framed container (`border border-muted rounded-xl shadow-sm hover:shadow-md transition-shadow`).
  - **Header Row**: Small colored icon indicating the resource type sitting flush next to the Document Title formatting (Bold, Primary text color).
  - **Body Section**: A 2-line truncated text preview of the document contents, or a small thumbnail snapshot window if the target is a whiteboard canvas.
  - **Footer Row**: Subtitle text `Last edited 2 days ago by [Avatar Graphic]`.
  - **Interaction**: The entire block receives `cursor-pointer` styling. Hovering applies an off-white or gray tint. Clicking routes the application directly to that resource view.
