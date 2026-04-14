# Specification: Auto-Formatting Code Blocks

## 📝 Product Requirement
When users paste code into a Code Block, the editor should automatically use the selected language to format the code perfectly (using Prettier).

## 🛠️ Technical Approach
- **TipTap Extension**: Modify `BlockCodeBlockLowlight` to intercept the `handlePaste` event specifically within code blocks.
- **Formatter**: Integrate a lightweight browser-compatible code formatter (e.g., Prettier standalone). Build language plugins mappings.

## ⚠️ Corner Cases & Edge Handling
- **Syntax Errors**: If the user pastes malformed code resulting in a formatter parse error, the editor must swallow the error silently and just paste the raw text instead of throwing a frontend crash or blocking the paste.
- **Large Pastes**: Avoid auto-formatting extremely large pastes (e.g. 10,000+ line JSON blobs) to prevent freezing the main thread; add a string length cutoff (e.g., > 10,000 characters skips format).
- **Line Endings & Cursors**: Calculate the precise cursor restoration position after transforming the text so the user's focus isn't lost on manual format triggers.

## 🎨 UI Design & Layout Details

- **Floating Menu Integration**:
  - The `CodeBlockFloatingMenu` already exists. Alongside the Language Mapping dropdown and "Copy" button, introduce a distinct "Magic Wand" (`🪄`) icon or a concise "Format" text button.
- **Formatter States**:
  - While formatting (fetching Prettier mapping logic): Disable the format button and optionally show a tiny loading ring.
- **Success Feedback Animation**:
  - When manually triggered, or automatically executed successfully on paste, display a quick "Format success" checkmark that overlays the wand icon for 1.5 seconds.
  - Give the code block background a tiny CSS flash animation (e.g., shifting background color `bg-primary/5` back to neutral over 400ms) to register the change visually to the user without being disruptive.
