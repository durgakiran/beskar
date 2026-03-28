import type { Editor } from '@tiptap/core';
import { getAttachmentPasteStorage } from '../attachment-paste-drop';
import { insertAttachmentsAt } from '../attachment-upload';

export interface Command {
  name: string;
  label: string;
  description: string;
  aliases?: string[];
  icon: string;
  action: (editor: Editor) => void;
  shouldBeHidden?: (editor: Editor) => boolean;
}

export interface Group {
  name: string;
  title: string;
  commands: Command[];
}

export const GROUPS: Group[] = [
  {
    name: 'format',
    title: 'Format',
    commands: [
      {
        name: 'heading1',
        label: 'Heading 1',
        icon: 'H1',
        description: 'Large section heading',
        aliases: ['h1'],
        action: (editor) => {
          editor.chain().focus().setHeading({ level: 1 }).run();
        },
      },
      {
        name: 'heading2',
        label: 'Heading 2',
        icon: 'H2',
        description: 'Medium section heading',
        aliases: ['h2'],
        action: (editor) => {
          editor.chain().focus().setHeading({ level: 2 }).run();
        },
      },
      {
        name: 'heading3',
        label: 'Heading 3',
        icon: 'H3',
        description: 'Small section heading',
        aliases: ['h3'],
        action: (editor) => {
          editor.chain().focus().setHeading({ level: 3 }).run();
        },
      },
      {
        name: 'bulletList',
        label: 'Bullet List',
        icon: '•',
        description: 'Create a bulleted list',
        aliases: ['ul', 'list'],
        action: (editor) => {
          editor.chain().focus().toggleBulletList().run();
        },
      },
      {
        name: 'numberedList',
        label: 'Numbered List',
        icon: '1.',
        description: 'Create a numbered list',
        aliases: ['ol', 'ordered'],
        action: (editor) => {
          editor.chain().focus().toggleOrderedList().run();
        },
      },
      {
        name: 'taskList',
        label: 'Task List',
        icon: '☐',
        description: 'Create a task list with checkboxes',
        aliases: ['todo', 'check', 'checkbox'],
        action: (editor) => {
          editor.chain().focus().toggleTaskList().run();
        },
      },
      {
        name: 'blockquote',
        label: 'Quote',
        icon: '"',
        description: 'Add a quote block',
        aliases: ['quote'],
        action: (editor) => {
          editor.chain().focus().setBlockquote().run();
        },
      },
      {
        name: 'codeBlock',
        label: 'Code Block',
        icon: '</>',
        description: 'Add a code block',
        aliases: ['code', 'pre'],
        action: (editor) => {
          editor.chain().focus().setCodeBlock().run();
        },
      },
      {
        name: 'mathBlock',
        label: 'Math Formula',
        icon: '∑',
        description: 'Add a LaTeX math formula',
        aliases: ['latex', 'equation', 'formula', 'math'],
        action: (editor) => {
          editor.chain().focus().setMathBlock().run();
        },
      },
      {
        name: 'tableOfContents',
        label: 'Table of Contents',
        icon: '📑',
        description: 'Insert a table of contents',
        aliases: ['toc', 'contents', 'index'],
        action: (editor) => {
          editor.chain().focus().setTableOfContents().run();
        },
      },
      {
        name: 'table',
        label: 'Table',
        icon: '⊞',
        description: 'Insert a 3x3 table',
        aliases: ['grid'],
        action: (editor) => {
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        },
      },
      {
        name: 'note',
        label: 'Note Block',
        icon: '📝',
        description: 'Add a highlighted note with custom styling',
        aliases: ['callout', 'info', 'alert'],
        action: (editor) => {
          editor.chain().focus().insertContent({
            type: 'noteBlock',
          }).run();
        },
      },
      {
        name: 'horizontalRule',
        label: 'Divider',
        icon: '—',
        description: 'Insert a horizontal line',
        aliases: ['hr', 'line', 'divider'],
        action: (editor) => {
          editor.chain().focus().setHorizontalRule().run();
        },
      },
      {
        name: 'details',
        label: 'Details',
        icon: '▼',
        description: 'Create a collapsible details block',
        aliases: ['collapse', 'summary', 'expand', 'dropdown'],
        action: (editor) => {
          editor.chain().focus().insertContent({
            type: 'details',
            attrs: { open: true },
            content: [
              {
                type: 'detailsSummary',
                content: [
                  {
                    type: 'text',
                    text: 'This is a summary',
                    marks: [{ type: 'bold' }],
                  },
                ],
              },
              {
                type: 'detailsContent',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Surprise!' }],
                  },
                ],
              },
            ],
          }).run();
        },
      },
      {
        name: 'twoColumns',
        label: '2 Columns',
        icon: '◫',
        description: 'Create a 2-column layout',
        aliases: ['columns', 'layout', 'grid', 'split'],
        action: (editor) => {
          editor.chain().focus().insertContent({
            type: 'columns',
            content: [
              {
                type: 'column',
                attrs: { width: 50 },
                content: [{ type: 'paragraph' }],
              },
              {
                type: 'column',
                attrs: { width: 50 },
                content: [{ type: 'paragraph' }],
              },
            ],
          }).run();
        },
      },
    ],
  },
  {
    name: 'media',
    title: 'Media',
    commands: [
      {
        name: 'image',
        label: 'Image',
        icon: '🖼️',
        description: 'Upload and display an image',
        aliases: ['img', 'photo', 'picture'],
        action: (editor) => {
          editor.chain().focus().insertContent({
            type: 'imageBlock',
          }).run();
        },
      },
      {
        name: 'fileAttachment',
        label: 'File attachment',
        icon: '📎',
        description: 'Upload a file (PDF, zip, spreadsheet, …)',
        aliases: ['file', 'attachment', 'upload', 'pdf', 'zip', 'csv', 'doc'],
        shouldBeHidden: (editor) =>
          !editor.isEditable || !getAttachmentPasteStorage(editor)?.attachmentHandler,
        action: (editor) => {
          const pasteOpts = getAttachmentPasteStorage(editor);
          const handler = pasteOpts?.attachmentHandler;
          if (!handler) return;

          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = pasteOpts?.allowedMimeAccept ?? '*';
          input.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:1px;height:1px;opacity:0;';
          document.body.appendChild(input);

          const cleanup = () => {
            input.remove();
            editor.chain().focus().run();
          };

          input.addEventListener('change', () => {
            const files = input.files ? Array.from(input.files) : [];
            if (files.length > 0) {
              const pos = editor.state.selection.from;
              insertAttachmentsAt(editor.view, pos, files, {
                handler,
                maxAttachmentBytes: pasteOpts?.maxAttachmentBytes,
                onAttachmentRejected: pasteOpts?.onAttachmentRejected,
              });
            }
            cleanup();
          });

          input.addEventListener('cancel', cleanup);

          requestAnimationFrame(() => {
            input.click();
          });
        },
      },
    ],
  },
];

export default GROUPS;
