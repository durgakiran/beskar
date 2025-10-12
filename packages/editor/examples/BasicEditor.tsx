import React, { useState } from 'react';
import { Editor } from '@beskar/editor';
import '@beskar/editor/styles.css';
import type { JSONContent } from '@tiptap/core';

/**
 * Basic Editor Example
 * 
 * This example shows how to use the editor with basic features:
 * - Initial content
 * - Content updates with auto-save
 * - Read-only mode toggle
 */
export function BasicEditorExample() {
  const [content, setContent] = useState<JSONContent>({
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
          { type: 'text', text: ' built on TipTap v3 with modern React patterns.' },
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
                content: [{ type: 'text', text: 'Text formatting (bold, italic, underline, strike)' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Lists (bullet, ordered, task lists)' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Tables with advanced operations' }],
              },
            ],
          },
        ],
      },
    ],
  });

  const [isEditable, setIsEditable] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const handleUpdate = (updatedContent: JSONContent) => {
    setContent(updatedContent);
    setLastSaved(new Date());
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Basic Editor Example</h1>
        <div className="flex gap-4 items-center">
          {lastSaved && (
            <span className="text-sm text-gray-500">
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setIsEditable(!isEditable)}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            {isEditable ? 'View Mode' : 'Edit Mode'}
          </button>
        </div>
      </div>

      <div className="border border-gray-300 rounded-lg p-4 min-h-[500px]">
        <Editor
          initialContent={content}
          editable={isEditable}
          placeholder="Start typing..."
          onUpdate={handleUpdate}
          onReady={(editor) => {
            console.log('Editor ready:', editor);
          }}
        />
      </div>

      <div className="mt-4 p-4 bg-gray-100 rounded">
        <h3 className="font-semibold mb-2">Content JSON:</h3>
        <pre className="text-xs overflow-auto max-h-64">
          {JSON.stringify(content, null, 2)}
        </pre>
      </div>
    </div>
  );
}

