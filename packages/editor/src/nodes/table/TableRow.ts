import { TableRow as TiptapTableRow } from '@tiptap/extension-table-row';

/**
 * Custom TableRow extension
 */
export const TableRow = TiptapTableRow.extend({
  allowGapCursor: false,
  content: '(tableCell | tableHeader)*',
});

export default TableRow;

