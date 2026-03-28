/**
 * StatusBadge — inline atomic status pill (e.g. IN PROGRESS, DONE).
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { StatusBadgeView } from '../components/status-badge/StatusBadgeView';
import { parseStatusBadgeColor } from './statusBadgeConstants';

export { STATUS_BADGE_COLORS, type StatusBadgeColor } from './statusBadgeConstants';

export const StatusBadge = Node.create({
  name: 'statusBadge',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: {
        default: 'IN PROGRESS',
        parseHTML: (el) => el.getAttribute('data-label') || 'IN PROGRESS',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
      color: {
        default: 'gray',
        parseHTML: (el) => parseStatusBadgeColor(el.getAttribute('data-color')),
        renderHTML: (attrs) => ({ 'data-color': attrs.color }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="status-badge"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label ?? 'IN PROGRESS');
    const c = parseStatusBadgeColor(String(node.attrs.color));
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'status-badge',
        'data-label': label,
        'data-color': c,
        class: `status-badge status-badge--${c}`,
      }),
      label,
    ];
  },

  renderText({ node }) {
    return `[${node.attrs.label}]`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(StatusBadgeView);
  },
});

export default StatusBadge;
