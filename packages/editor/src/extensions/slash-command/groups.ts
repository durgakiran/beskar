import type { Editor } from '@tiptap/core';

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
        name: 'horizontalRule',
        label: 'Divider',
        icon: '—',
        description: 'Insert a horizontal line',
        aliases: ['hr', 'line', 'divider'],
        action: (editor) => {
          editor.chain().focus().setHorizontalRule().run();
        },
      },
    ],
  },
];

export default GROUPS;

