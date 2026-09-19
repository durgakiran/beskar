import { InputRule } from '@tiptap/core';
import { Typography } from '@tiptap/extension-typography';

// Smart punctuation must not rewrite LaTeX while a dollar shortcut is being typed.
export const MathAwareTypography = Typography.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(rule => new InputRule({
      find: rule.find,
      handler: props => {
        const { $from } = props.state.selection;
        const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc');
        if (this.editor.schema.nodes.inlineMath && (before.match(/\$\$/g)?.length ?? 0) % 2 === 1) return null;
        return rule.handler(props);
      },
    }));
  },
});
