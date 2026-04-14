# Specification: User Mentions (@mentions)

## 📝 Product Requirement
Users can type `@` to bring up a list of workspace users. Selecting a user inserts a distinct "mention" pill into the document and notifies that user.

## 🛠️ Technical Approach
- **TipTap Extension**: Use the official `@tiptap/extension-mention` package. 
- **Data Model**: The mention node should store `data-user-id` and `data-user-name`.
- **Notifications**: Hook into the editor's save/update lifecycle to parse new mentions. Ensure we do not spam notifications for unchanged mentions.

## ⚠️ Corner Cases & Edge Handling
- **Deleted Users**: If a mentioned user is later deleted or removed from the workspace, the mention should fallback gracefully to inactive text (e.g. `@Deleted User`) rather than crashing the render.
- **Network Latency**: Handle debouncing and loading states when fetching the mention list from the backend for large workspaces (e.g. 500ms debounce).
- **Cross-document Pasting**: If a mention is copy-pasted into a document where that user lacks read permissions, it should still behave safely without leaking sensitive data.

## 🎨 UI Design & Layout Details
- **Trigger Menu**: A floating dropdown list attached precisely below the `@` cursor position.
- **Dropdown List UI**:
  - Max height container to prevent screen takeover (e.g., `max-h-64 overflow-y-auto`).
  - Dark/Light mode compatible surface with a soft shadow and rounded corners (`shadow-lg rounded-md border border-border bg-background`).
  - **List Item Layout**: Flex row layout. Left side: Avatar (circular image or colored initials placeholder). Right side: Bold full username with small, subtle email/handle text directly underneath.
  - **Active State**: Highlight the active list item (e.g., `bg-muted` or a slight primary tint) mapped strictly to Keyboard Up/Down arrow navigation.
- **Mention Pill (In-document)**: 
  - Rendered inline as a non-breaking pill, e.g., `<span class="bg-blue-100 text-blue-800 rounded px-1.5 py-0.5 font-medium">@Kiran</span>`.
  - Non-editable internally; deleting it removes the entire block atomically.
