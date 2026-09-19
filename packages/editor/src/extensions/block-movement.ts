import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

/** The shared identity/handle registry. Structural children move with their top-level block. */
export const BLOCK_TYPES = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote',
  'codeBlock', 'table', 'horizontalRule', 'details', 'noteBlock', 'imageBlock',
  'attachmentBlock', 'mathBlock', 'tableOfContents', 'columns', 'embedBlock',
  'internalLinkBlock', 'childPagesList',
];
export interface DocumentBlock { id: string; node: PMNode; pos: number }
export interface BlockDestination { id: string; side: 'before' | 'after' }
export const BLOCK_MOVED = 'beskarBlockMoved';

export function documentBlocks(doc: PMNode, types = BLOCK_TYPES): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  doc.forEach((node, pos) => {
    if (node.attrs.blockId && types.includes(node.type.name)) blocks.push({ id: node.attrs.blockId, node, pos });
  });
  return blocks;
}

export function selectedBlock(state: EditorState, types = BLOCK_TYPES): DocumentBlock | undefined {
  const pos = state.selection.from;
  return documentBlocks(state.doc, types).find(b => pos >= b.pos && pos < b.pos + b.node.nodeSize);
}

/** Read-only eligibility check, also used by command `can()` and drag preview. */
export function canMoveBlock(state: EditorState, sourceId: string, destination: BlockDestination, types = BLOCK_TYPES): boolean {
  const blocks = documentBlocks(state.doc, types);
  const source = blocks.find(b => b.id === sourceId);
  const target = blocks.find(b => b.id === destination.id);
  if (!source || !target || source === target || blocks.filter(b => b.id === sourceId).length !== 1 || blocks.filter(b => b.id === destination.id).length !== 1) return false;
  const insertion = target.pos + (destination.side === 'after' ? target.node.nodeSize : 0);
  return insertion !== source.pos && insertion !== source.pos + source.node.nodeSize;
}

/** Resolve BOTH endpoints against the live document, never a drag-start snapshot. */
export function moveBlockTransaction(
  state: EditorState, sourceId: string, destination: BlockDestination,
  types = BLOCK_TYPES, selectMoved = false,
): Transaction | null {
  const blocks = documentBlocks(state.doc, types);
  const source = blocks.find(b => b.id === sourceId);
  const target = blocks.find(b => b.id === destination.id);
  if (!source || !target || !canMoveBlock(state, sourceId, destination, types)) return null;
  const insertion = target.pos + (destination.side === 'after' ? target.node.nodeSize : 0);
  const end = source.pos + source.node.nodeSize;
  if (insertion === source.pos || insertion === end) return null;
  const tr = closeHistory(state.tr);
  tr.delete(source.pos, end);
  const mapped = tr.mapping.map(insertion, destination.side === 'before' ? -1 : 1);
  // Insertion must remain a valid root boundary. Never let schema fitting silently change a block.
  const $mapped = tr.doc.resolve(mapped);
  if ($mapped.depth !== 0 || !tr.doc.canReplaceWith($mapped.index(), $mapped.index(), source.node.type, source.node.marks)) return null;
  tr.insert(mapped, source.node);
  const selection = state.selection;
  if (!selectMoved && selection instanceof TextSelection && selection.from >= source.pos && selection.to <= end) {
    tr.setSelection(TextSelection.create(tr.doc, mapped + selection.anchor - source.pos, mapped + selection.head - source.pos));
  } else if (selectMoved || (selection instanceof NodeSelection && selection.from === source.pos)) {
    tr.setSelection(NodeSelection.create(tr.doc, mapped));
  }
  return tr.setMeta(BLOCK_MOVED, sourceId).scrollIntoView();
}

export function siblingDestination(state: EditorState, id: string, direction: -1 | 1, types = BLOCK_TYPES): BlockDestination | null {
  const blocks = documentBlocks(state.doc, types);
  const index = blocks.findIndex(b => b.id === id);
  const neighbor = index < 0 ? undefined : blocks[index + direction];
  return neighbor ? { id: neighbor.id, side: direction < 0 ? 'before' : 'after' } : null;
}
