import { InputRule } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

export const INLINE_MATH_INPUT = /(?:^|[^$])(\$\$([^$]+)\$\$) $/;
export const EMPTY_INLINE_MATH_INPUT = /(?:^|[^$])(\$\$) $/;
export const BLOCK_MATH_INPUT = /^\$\$\$\$ $/;

export function inlineMathInputRules(type: NodeType) {
  return [INLINE_MATH_INPUT, EMPTY_INLINE_MATH_INPUT].map(find => new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const start = range.from + match[0].indexOf('$$');
      const latex = match[2] ?? '';
      const tr = state.tr.replaceWith(start, range.to, type.create({ latex }));
      tr.setSelection(latex ? TextSelection.create(tr.doc, start + 1) : NodeSelection.create(tr.doc, start));
    },
  }));
}

export function blockMathInputRule(type: NodeType) {
  return new InputRule({
    find: BLOCK_MATH_INPUT,
    handler: ({ state, range }) => {
      const $from = state.doc.resolve(range.from);
      // Never discard text after the cursor or violate a parent's required paragraph.
      if ($from.parent.textContent !== '$$$$' || $from.parent.type.name !== 'paragraph') return null;
      const parent = $from.node(-1);
      const index = $from.index(-1);
      if (!parent.canReplaceWith(index, index + 1, type)) return null;
      const start = $from.before();
      const tr = state.tr.replaceWith(start, $from.after(), type.create({ latex: '', displayMode: true }));
      tr.setSelection(NodeSelection.create(tr.doc, start));
    },
  });
}
