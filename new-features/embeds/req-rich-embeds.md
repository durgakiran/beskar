# Specification: Rich Embeds (Media & Vectors)

## 📝 Product Requirement
Users can embed interactive diagrams or generic iframes directly into the page layout. This makes documents much more powerful as unified workspaces for multiple platforms.

## 🧰 Supported Providers
We will explicitly support and optimize rendering for the following platforms, plus a fallback generic iframe:
- **Design & Diagrams**: Figma, Excalidraw, Miro, Draw.io, Framer
- **Video & Rich Media**: YouTube, Vimeo, Loom
- **Productivity & Docs**: Google Drive, Google Sheets, Airtable, Typeform
- **Custom**: Generic Iframe

## 🛠️ Technical Approach
- **TipTap Extension**: Create an `EmbedBlock` node extension parsing raw URLs securely into `src` tags alongside a `provider` property to track what service is embedded.
- **Auto-Linking (PasteRules)**: Add a TipTap `PasteRule` to seamlessly convert known provider URLs (e.g., pasting a YouTube link) directly into an `EmbedBlock` avoiding the need for users to manually trigger a menu.
- **Slash Menu Integration**: Populate individual `/` commands for each supported provider (e.g., `/youtube`, `/figma`, `/airtable`) to increase discoverability, plus a generic `/embed` or `/iframe`.

## ⚠️ Corner Cases & Edge Handling
- **Invalid URLs**: Provide a clean error message inside the `NodeView` Popover when an invalid URL for a specific provider is pasted.
- **CSP & Security**: Only allow embedded iframes from an explicit whitelist of trusted domains or sanitize the input thoroughly to prevent XSS payloads. Configure the iframe `sandbox` with `allow-scripts allow-same-origin allow-forms allow-popups`.
- **Private/Authenticated Links**: By utilizing `allow-same-origin` in the sandbox attributes, the iframe will naturally pass the user's existing browser cookies for that domain. If they don't have access, the iframe will natively render the provider's fallback (e.g. Figma's "Request Access" or Google's "Sign In" screen). We do not proxy credentials.
- **Responsive Layout**: Ensure embedded iframes correctly shrink on mobile viewports without breaking the horizontal overflow of the editor container. Need to preserve the provider's optimal aspect ratio where possible.

## 🎨 UI Design & Layout Details

- **Slash Menu Context**: Each supported provider receives a dedicated row under a `Media` or `Integrations` category with its respective official brand icon.
- **Empty State UI**: 
  - Instead of a generic input, when a provider-specific slash command is used (e.g. `/figma`), the editor renders a targeted placeholder Popover:
  - Features the specific provider icon, a soft background, and an autofocus input field: `[ Enter Figma link to embed ]` with an "Embed" CTA button. 
- **Live Iframe State**:
  - The iframe replaces the empty state entirely, maintaining a functional default layout.
  - **Selection UX**: If the user clicks on the edge or uses keyboard navigation to select the `EmbedBlock`, a heavy focus ring appears (`ring-2 ring-primary ring-offset-2`).
  - **Floating Menu**: A floating toolbar appears centered above the selected embed offering tools: `[Edit Link ✏️]`, `[Open in New Tab ↗️]`, `[Align Left|Center|Right]`, and `[Delete]`.
  - **Resize Handles**: Provide grabber nodes on the corners/edges allowing the user to explicitly define the dimensions of the embed box, persisting width/height explicitly in the node attributes.
