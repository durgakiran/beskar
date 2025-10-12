import { useState, useCallback } from 'react';
import { Editor, BubbleMenu, BubbleMenuButton } from '@beskar/editor';
import type { Editor as TiptapEditor } from '@beskar/editor';
import '@beskar/editor/styles.css';
import './App.css';

const initialContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Welcome to Beskar Editor!' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This is a ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'rich text editor' },
        { type: 'text', text: ' built on ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'TipTap v3' },
        { type: 'text', text: ' with ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'React 19' },
        { type: 'text', text: ' and ' },
        { type: 'text', marks: [{ type: 'underline' }], text: 'Radix UI' },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Features' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Text formatting:' },
                { type: 'text', text: ' bold, italic, underline, strike, code' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Lists:' },
                { type: 'text', text: ' bullet, ordered, and task lists' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Tables:' },
                { type: 'text', text: ' with resizing and advanced operations' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Collaboration:' },
                { type: 'text', text: ' real-time editing with Y.js' },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Block-Based Editor' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This is a ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'block-based editor' },
        { type: 'text', text: '. Each paragraph, heading, and list is a separate block. Hover over any block to see the highlight!' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Try These Features:' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Hover' },
                { type: 'text', text: ' over any block to see subtle highlighting' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Type "/"' },
                { type: 'text', text: ' at the start of any line for slash commands' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Select text' },
                { type: 'text', text: ' to see the bubble menu for formatting' },
              ],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', marks: [{ type: 'bold' }], text: 'Create blocks' },
                { type: 'text', text: ' with headings, lists, tables, code blocks, and more' },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Sample Table' }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header 1' }] }],
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header 2' }] }],
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header 3' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 1-1' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 1-2' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 1-3' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 2-1' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 2-2' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 2-3' }] }],
            },
          ],
        },
      ],
    },
    {
      type: 'paragraph',
    },
  ],
};

function App() {
  const [content, setContent] = useState(initialContent);
  const [isEditable, setIsEditable] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);

  const handleUpdate = useCallback((updatedContent: any) => {
    setContent(updatedContent);
    setLastSaved(new Date());
  }, []);

  const handleReady = useCallback((editorInstance: TiptapEditor) => {
    console.log('Editor ready:', editorInstance);
    setEditor(editorInstance);
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Beskar Editor Demo</h1>
        <div className="header-controls">
          {lastSaved && (
            <span className="last-saved">
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setIsEditable(!isEditable)}
            className="toggle-button"
          >
            {isEditable ? '👁️ View Mode' : '✏️ Edit Mode'}
          </button>
        </div>
      </header>

      <main className="editor-container">
        <Editor
          initialContent={initialContent}
          editable={isEditable}
          placeholder="Start typing..."
          onUpdate={handleUpdate}
          onReady={handleReady}
          className={isEditable ? 'editable' : 'readonly'}
        />
        
        {/* Bubble Menu for text formatting */}
        {editor && isEditable && (
          <BubbleMenu editor={editor}>
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive('bold')}
              title="Bold (Cmd+B)"
            >
              <strong>B</strong>
            </BubbleMenuButton>
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive('italic')}
              title="Italic (Cmd+I)"
            >
              <em>I</em>
            </BubbleMenuButton>
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              isActive={editor.isActive('underline')}
              title="Underline (Cmd+U)"
            >
              <u>U</u>
            </BubbleMenuButton>
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive('strike')}
              title="Strikethrough"
            >
              <s>S</s>
            </BubbleMenuButton>
            <BubbleMenuButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={editor.isActive('code')}
              title="Code"
            >
              {'</>'}
            </BubbleMenuButton>
          </BubbleMenu>
        )}
      </main>

      <footer className="app-footer">
        <details className="json-viewer">
          <summary>📄 View Content JSON</summary>
          <pre>{JSON.stringify(content, null, 2)}</pre>
        </details>
      </footer>
    </div>
  );
}

export default App;
