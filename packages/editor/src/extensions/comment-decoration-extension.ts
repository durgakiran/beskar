import { Extension } from '@tiptap/core';
import { commentDecorationPlugin } from './comment-decoration';

export const CommentDecoration = Extension.create({
  name: 'commentDecoration',

  addProseMirrorPlugins() {
    return [commentDecorationPlugin(this.editor.options.editable === true)];
  },
});
