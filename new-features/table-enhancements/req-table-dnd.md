# Specification: Advanced Table Drag-and-Drop

## 📝 Product Requirement
Users need the ability to smoothly drag and drop rows/columns visually to reorganize tables.

## 🛠️ Technical Approach
- **TipTap Extension**: Enhance the existing `RowDragHandle` and `ColumnDragHandle` components integrated tightly with ProseMirror's transaction API.
- **Implementation**: Needs to map mouse events visually over the table DOM and accurately fire standard `moveColumn(from, to)` or `moveRow(from, to)` TipTap commands on drop.

## ⚠️ Corner Cases & Edge Handling
- **Merged Cells (Colspans/Rowspans)**: Disable drag-and-drop handles for rows/columns that contain merged cells or correctly calculate the intersection to prevent corrupting the table layout (ProseMirror's table schemas notoriously break on illegal spans).
- **Out of Bounds Drop**: Handle drops completely outside of the current table bounds by silently cancelling the slice transaction.
- **History Grouping**: Ensure the complex drag-and-drop action resolves to a single step in the `UndoManager` stack so `Ctrl+Z` reverses the move entirely rather than just halfway.

## 🎨 UI Design & Layout Details

- **Drag Grabbers**:
  - Distinct subtle grabber icons (`grip-vertical` for rows, `grip-horizontal` for cols) that appear dynamically *only* on hover over the row/col margins outside the table boundaries (left gutter for rows, top margin for columns).
  - Hovering over a grabber highlights the entire targeted row/col with a bright, ultra-light accent color (`bg-primary/10`).
- **Dragging Ghost State**:
  - When actively dragging, the dragged row/col ghost is rendered semi-transparently attached to the cursor mapping.
- **Target Drop Indicator**:
  - A highly visible, high-contrast primary colored line (e.g., thick blue line `border-b-2 border-primary`) positioned dynamically between the rows or columns closest to the cursor. This provides absolute clarity on exactly where the array insertion point occurs.
