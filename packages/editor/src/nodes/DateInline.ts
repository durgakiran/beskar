/**
 * DateInline — inline atomic date pill with popover editing.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DateInlineView } from '../components/date/DateInlineView';
import {
  formatDateLabel,
  getTodayDateValue,
  isValidDateValue,
} from './dateInlineUtils';

export interface DateInlineAttributes {
  value: string;
}

export const DateInline = Node.create({
  name: 'dateInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      value: {
        default: getTodayDateValue(),
        parseHTML: (el) => el.getAttribute('data-value') || getTodayDateValue(),
        renderHTML: (attrs) => ({ 'data-value': attrs.value }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="date-inline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const value = String(node.attrs.value ?? '');
    const isValid = isValidDateValue(value);

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'date-inline',
        'data-value': value,
        class: `date-inline${isValid ? '' : ' date-inline--invalid'}`,
      }),
      formatDateLabel(value),
    ];
  },

  renderText({ node }) {
    return formatDateLabel(String(node.attrs.value ?? ''));
  },

  addNodeView() {
    return ReactNodeViewRenderer(DateInlineView);
  },
});

export default DateInline;
