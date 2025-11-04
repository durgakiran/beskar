import { useState, useCallback, useEffect } from 'react';
import { Editor, TableFloatingMenu, TextFormattingMenu, CodeBlockFloatingMenu } from '@beskar/editor';
import { CommentSidebar, EndOfPageComments, CommentClickHandler, CreateCommentHandler } from '@beskar/editor';
import type { TiptapEditor, ImageAPIHandler } from '@beskar/editor';
import type { Comment } from '@beskar/editor';

// Extend Comment type for demo
interface CommentWithType extends Comment {
  commentType: 'inline' | 'page_end';
}
// Import Radix UI styles first, then editor styles so editor can use Radix variables
import '@beskar/editor/styles.css';
import './App.css';
import { Button } from '@radix-ui/themes';
import { mockCommentAPI, mockUser } from './mockCommentAPI';

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
  const [comments, setComments] = useState<CommentWithType[]>([]);
  const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
  const [selectedText, setSelectedText] = useState<string>('');
  const [showCreateComment, setShowCreateComment] = useState(false);
  const [createCommentPosition, setCreateCommentPosition] = useState<{ x: number; y: number } | undefined>();

  const handleUpdate = useCallback((updatedContent: any) => {
    console.log('updatedContent:', updatedContent);
    setContent(updatedContent);
    setLastSaved(new Date());
  }, []);

  const handleReady = useCallback((editorInstance: TiptapEditor) => {
    console.log('Editor ready:', editorInstance);
    setEditor(editorInstance);
    
    // Listen for selection changes to enable comment creation
    editorInstance.on('selectionUpdate', () => {
      const { from, to } = editorInstance.state.selection;
      if (from !== to) {
        const selectedText = editorInstance.state.doc.textBetween(from, to);
        setSelectedText(selectedText);
      } else {
        setSelectedText('');
      }
    });
  }, []);

  // Load comments on mount
  useEffect(() => {
    const loadComments = async () => {
      try {
        const loadedComments = await mockCommentAPI.getComments();
        setComments(loadedComments);
      } catch (error) {
        console.error('Failed to load comments:', error);
      }
    };
    loadComments();
  }, []);

  // Handle creating inline comment - opens the create comment popup
  const handleCreateInlineComment = useCallback(() => {
    if (!editor || !selectedText) return;

    // Check if selection is in a code block or non-text node
    const { selection } = editor.state;
    const { $from } = selection;

    // Find the parent node to check if it's a code block
    let depth = $from.depth;
    
    // Traverse up to find block-level node
    while (depth > 0) {
      const parent = $from.node(depth);
      if (parent.type.name === 'codeBlock' || parent.type.name === 'code') {
        alert('Cannot add comments to code blocks');
        return;
      }
      depth--;
    }

    // Check if selection is in a non-text block
    const blockNode = $from.node($from.depth);
    const nonTextBlocks = ['imageBlock', 'mathBlock', 'horizontalRule', 'table'];
    if (nonTextBlocks.includes(blockNode.type.name)) {
      alert('Cannot add comments to this type of block');
      return;
    }

    // Calculate position for popup - at leftmost position of selection
    const { from } = selection;
    const startRect = editor.view.coordsAtPos(from);
    
    const position = {
      x: startRect.left + window.scrollX, // Left edge of selection
      y: startRect.top + window.scrollY - 150, // Position above selection to avoid bubble menu
    };

    setCreateCommentPosition(position);
    setShowCreateComment(true);
  }, [editor, selectedText]);

  // Handle submit comment from popup
  const handleSubmitComment = useCallback(async (commentText: string) => {
    if (!editor || !commentText.trim()) return;

    try {
      const newComment = await mockCommentAPI.createComment({
        commentType: 'inline',
        commentText,
        isDraft: false,
      });

      // Add comment mark to selected text
      // Note: The mark is applied to the current selection
      if (editor.state.selection.from !== editor.state.selection.to) {
        editor.chain().focus().setComment({ commentId: newComment.id }).run();
      }

      // Reload comments
      const updatedComments = await mockCommentAPI.getComments();
      setComments(updatedComments);
      setSelectedText('');
      setShowCreateComment(false);
    } catch (error) {
      console.error('Failed to create comment:', error);
      alert('Failed to create comment');
    }
  }, [editor]);

  // Handle creating page-end comment
  const handleCreatePageComment = useCallback(async (commentText: string) => {
    if (!commentText.trim()) return;

    try {
      await mockCommentAPI.createComment({
        commentType: 'page_end',
        commentText,
        isDraft: false,
      });

      // Reload comments
      const updatedComments = await mockCommentAPI.getComments();
      setComments(updatedComments);
    } catch (error) {
      console.error('Failed to create comment:', error);
      // Don't show alert, just log error
    }
  }, []);

  // Handle comment actions
  const handleReply = useCallback(async (commentId: string, replyText?: string) => {
    const commentText = replyText || prompt('Enter your reply:');
    if (!commentText) return;

    try {
      await mockCommentAPI.createComment({
        commentType: 'inline',
        commentText,
        parentCommentId: commentId,
        isDraft: false,
      });

      const updatedComments = await mockCommentAPI.getComments();
      setComments(updatedComments);
    } catch (error) {
      console.error('Failed to reply:', error);
      alert('Failed to reply');
    }
  }, []);

  const handleEdit = useCallback(async (commentId: string, newText?: string) => {
    if (!newText) return; // If no newText provided, don't do anything (shouldn't happen)
    
    const comment = comments.find((c) => c.id === commentId);
    if (!comment) return;

    if (newText === comment.commentText) return; // No change

    try {
      await mockCommentAPI.updateComment(commentId, newText);
      // Reload comments to get updated data
      const updatedComments = await mockCommentAPI.getComments();
      setComments(updatedComments);
    } catch (error) {
      console.error('Failed to edit comment:', error);
      // Don't show alert, just log error
    }
  }, [comments]);

  const handleDelete = useCallback(async (commentId: string) => {
    try {
      await mockCommentAPI.deleteComment(commentId);
      
      // Remove comment mark from editor if it's an inline comment
      const deletedComment = comments.find((c) => c.id === commentId);
      if (editor && deletedComment && deletedComment.commentType === 'inline') {
        // Find and remove the comment mark from the document
        editor.state.doc.descendants((node, pos) => {
          if (node.marks) {
            const commentMark = node.marks.find(
              (m) => m.type.name === 'comment' && m.attrs.commentId === commentId
            );
            if (commentMark) {
              // Remove the mark from this position
              editor.commands.setTextSelection({ from: pos, to: pos + node.nodeSize });
              editor.chain().focus().unsetComment().run();
            }
          }
        });
      }

      // Reload comments to get updated list
      const updatedComments = await mockCommentAPI.getComments();
      setComments(updatedComments);
    } catch (error) {
      console.error('Failed to delete comment:', error);
      // Don't show alert, just log error
    }
  }, [editor, comments]);

  const handleResolve = useCallback(async (commentId: string, resolved: boolean) => {
    try {
      await mockCommentAPI.resolveComment(commentId, resolved);
      const updatedComments = await mockCommentAPI.getComments();
      setComments(updatedComments);
    } catch (error) {
      console.error('Failed to resolve comment:', error);
      alert('Failed to resolve comment');
    }
  }, []);

  // Separate comments by type
  const inlineComments = comments.filter((c) => c.commentType === 'inline');
  const pageEndComments = comments.filter((c) => c.commentType === 'page_end');

  // Example image upload handler
  // In a real application, you would upload to your server/CDN
  const imageHandler: ImageAPIHandler = {
    uploadImage: async (file: File) => {
      console.log('[Demo] Uploading image:', file.name);
      
      // Simulate upload delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // In a real app, upload to your server:
      // const formData = new FormData();
      // formData.append('image', file);
      // const response = await fetch('/api/upload', { method: 'POST', body: formData });
      // const { url, width, height } = await response.json();
      
      // For demo, convert to data URL (not recommended for production)
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      
      console.log('[Demo] Upload complete');
      
      return {
        url: dataUrl,
        alt: file.name,
      };
    },
    getImageUrl: (url: string) => {
      // Optional: Transform URL for CDN (e.g., add resize params)
      // return `${url}?w=800&q=80`;
      return url;
    },
  };

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
          <Button
            onClick={() => setShowCommentsSidebar(!showCommentsSidebar)}
            variant="soft"
          >
            💬 Comments ({comments.length})
          </Button>
          <Button
            onClick={() => setIsEditable(!isEditable)}
            className="toggle-button"
            variant="soft"
          >
            {isEditable ? '👁️ View Mode' : '✏️ Edit Mode'}
          </Button>
        </div>
      </header>

      <div className="main-layout">
        <main className="editor-container">
        <Editor
          initialContent={initialContent}
          editable={isEditable}
          placeholder="Start typing..."
          onUpdate={handleUpdate}
          onReady={handleReady}
          className={isEditable ? 'editable' : 'readonly'}
          imageHandler={imageHandler}
        />
        
        {/* Bubble Menu for text formatting */}
        {editor && isEditable && (
          <>
            <TextFormattingMenu 
              editor={editor} 
              onAddComment={handleCreateInlineComment}
              canComment={true}
            />
            {/* <BubbleMenu editor={editor}>
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
              <BubbleMenuButton
                onClick={() => editor.chain().focus().toggleMath().run()}
                isActive={editor.isActive('math')}
                title="Math"
              >
                <span>Math</span>
              </BubbleMenuButton>
            </BubbleMenu> */}
            
            {/* Table Floating Menu */}
            <TableFloatingMenu editor={editor} />
            
            {/* Code Block Floating Menu */}
            <CodeBlockFloatingMenu editor={editor} />
          </>
        )}

        {/* Comment Click Handler - shows popup on click */}
        {editor && (
          <>
            <CommentClickHandler
              editor={editor}
              comments={inlineComments}
              getReplies={(commentId) => {
                return comments.filter((c) => c.parentCommentId === commentId);
              }}
              getReactions={async (commentId) => {
                try {
                  return await mockCommentAPI.getReactions(commentId);
                } catch (error) {
                  console.error('Failed to get reactions:', error);
                  return [];
                }
              }}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onResolve={handleResolve}
              onAddEmoji={async (commentId, emoji) => {
                try {
                  await mockCommentAPI.addReaction(commentId, emoji);
                  // Reload comments to refresh reactions
                  const updatedComments = await mockCommentAPI.getComments();
                  setComments(updatedComments);
                } catch (error) {
                  console.error('Failed to add reaction:', error);
                }
              }}
              onRemoveEmoji={async (commentId, emoji) => {
                try {
                  await mockCommentAPI.removeReaction(commentId, emoji);
                  // Reload comments to refresh reactions
                  const updatedComments = await mockCommentAPI.getComments();
                  setComments(updatedComments);
                } catch (error) {
                  console.error('Failed to remove reaction:', error);
                }
              }}
              currentUserId={mockUser.id}
            />
            {/* Create Comment Handler - shows popup when adding new comment */}
            <CreateCommentHandler
              editor={editor}
              show={showCreateComment}
              position={createCommentPosition}
              onClose={() => {
                setShowCreateComment(false);
                setCreateCommentPosition(undefined);
              }}
              onSubmit={handleSubmitComment}
              authorName={mockUser.name}
              authorEmail={mockUser.email}
              authorInitials="DU"
            />
          </>
        )}
        </main>

        {showCommentsSidebar && (
          <aside className="comments-sidebar">
            <CommentSidebar
              comments={comments}
              inlineComments={inlineComments}
              pageEndComments={pageEndComments}
              onCommentClick={(commentId: string) => {
                // Scroll to comment in editor if it's inline
                const comment = comments.find((c) => c.id === commentId);
                if (comment && comment.commentType === 'inline' && editor) {
                  // Find and highlight the comment mark
                  editor.state.doc.descendants((node, pos) => {
                    if (node.marks) {
                      const commentMark = node.marks.find(
                        (m) => m.type.name === 'comment' && m.attrs.commentId === commentId
                      );
                      if (commentMark) {
                        editor.commands.setTextSelection({ from: pos, to: pos + node.nodeSize });
                        // Scroll to position
                        const dom = editor.view.domAtPos(pos).node;
                        if (dom instanceof HTMLElement) {
                          dom.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }
                    }
                  });
                }
              }}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onResolve={handleResolve}
              currentUserId={mockUser.id}
            />
          </aside>
        )}
      </div>

          <EndOfPageComments
            comments={pageEndComments}
            onAddComment={handleCreatePageComment}
            onReply={handleReply}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onResolve={handleResolve}
            currentUserId={mockUser.id}
            canComment={true}
            authorName={mockUser.name}
            authorEmail={mockUser.email}
            authorInitials="DU"
          />

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
