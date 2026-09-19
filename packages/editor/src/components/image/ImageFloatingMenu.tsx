/**
 * ImageFloatingMenu - Floating toolbar for image blocks
 */

import React, { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { FiAlignLeft, FiAlignCenter, FiAlignRight } from 'react-icons/fi';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { copyImageBlock, deleteImageBlock } from './utils';

interface ImageFloatingMenuProps {
  editor: Editor;
  getPos: (() => number | undefined) | boolean;
  currentAlign: 'left' | 'center' | 'right';
  updateAttributes: (attrs: Record<string, any>) => void;
  nodeAttrs?: Record<string, any>;
  src?: string;
  onMenuOpenChange?: (open: boolean) => void;
}

export function ImageFloatingMenu({ editor, getPos, currentAlign, updateAttributes, src, onMenuOpenChange }: ImageFloatingMenuProps) {
  const [status, setStatus] = useState('');
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    if (!src || downloading) return;
    setDownloading(true);
    setStatus('');
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'png';
      link.href = url;
      link.download = `image.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus('Download started');
    } catch {
      setStatus('Could not download image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };
  const handleDuplicate = () => {
    if (!editor.isEditable || typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined) return;
    const node = editor.state.doc.nodeAt(pos);
    if (node?.type.name !== 'imageBlock') return;
    editor.chain().focus().insertContentAt(pos + node.nodeSize, {
      type: 'imageBlock', attrs: { ...node.attrs, blockId: null },
    }).run();
  };
  const handleCopy = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined) return;
    editor.chain().focus().setNodeSelection(pos).run();
    setStatus(copyImageBlock(editor) ? 'Image copied' : 'Could not copy image. Try the keyboard copy shortcut.');
  };

  const handleDelete = () => {
    console.log('[ImageFloatingMenu] Delete clicked');
    
    // Focus on the image node first
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined && pos >= 0) {
        editor.chain().focus().setNodeSelection(pos).run();
        
        // Small delay to ensure selection is updated
        setTimeout(() => {
          deleteImageBlock(editor);
        }, 10);
        return;
      }
    }
    
    deleteImageBlock(editor);
  };

  const handleAlignChange = (align: 'left' | 'center' | 'right') => {
    console.log('[ImageFloatingMenu] Align changed to:', align);
    updateAttributes({ align });
  };

  const handleConvertToInline = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined) return;

    const { schema, doc } = editor.state;
    const inlineSchema = schema.nodes.imageInline;
    if (!inlineSchema) return;

    const blockNode = doc.nodeAt(pos);
    if (!blockNode) return;

    const { src, alt, caption } = blockNode.attrs;
    // Don't carry over block dimensions — ImageInlineView will auto-size to the
    // default inline height (24 px) once the image loads, matching paste behaviour.
    const inlineNode = inlineSchema.create({ src, alt, caption, width: null, height: null, uploadStatus: 'idle' });

    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        // Replace the block node with a paragraph containing the inline image
        const para = schema.nodes.paragraph.create({}, inlineNode);
        tr.replaceWith(pos, pos + blockNode.nodeSize, para);
        return true;
      })
      .run();
  };

  return (
    <div contentEditable={false} className="image-block-toolbar-floating" style={{ top: '-3.5rem', bottom: 'auto' }}>
      <Toolbar.Root className="editor-floating-toolbar">
        <Toolbar.Button className="editor-floating-toolbar-button" onClick={handleDownload} disabled={downloading || !src} aria-label="Download image">
          {downloading ? 'Downloading…' : 'Download'}
        </Toolbar.Button>
        {editor.isEditable && <>
        <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />
        {/* Alignment buttons */}
        <Toolbar.Button
          className={`editor-floating-toolbar-button ${currentAlign === 'left' ? 'active' : ''}`}
          onClick={() => handleAlignChange('left')}
          aria-pressed={currentAlign === 'left'}
          aria-label="Align left"
          title="Align left"
        >
          <FiAlignLeft size={16} />
        </Toolbar.Button>
        <Toolbar.Button
          className={`editor-floating-toolbar-button ${currentAlign === 'center' ? 'active' : ''}`}
          onClick={() => handleAlignChange('center')}
          aria-pressed={currentAlign === 'center'}
          aria-label="Align center"
          title="Align center"
        >
          <FiAlignCenter size={16} />
        </Toolbar.Button>
        <Toolbar.Button
          className={`editor-floating-toolbar-button ${currentAlign === 'right' ? 'active' : ''}`}
          onClick={() => handleAlignChange('right')}
          aria-pressed={currentAlign === 'right'}
          aria-label="Align right"
          title="Align right"
        >
          <FiAlignRight size={16} />
        </Toolbar.Button>
        <DropdownMenu.Root modal={false} onOpenChange={onMenuOpenChange}>
          <DropdownMenu.Trigger asChild>
            <Toolbar.Button className="editor-floating-toolbar-button" aria-label="More image actions">More</Toolbar.Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
          <DropdownMenu.Content className="image-actions-menu" sideOffset={6}>
            <DropdownMenu.Item onSelect={handleCopy}>Copy</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={handleDuplicate}>Duplicate</DropdownMenu.Item>
            <DropdownMenu.Item onSelect={handleConvertToInline}>Inline</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={handleDelete}>Delete</DropdownMenu.Item>
          </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        </>}
      </Toolbar.Root>
      {status && <div className="image-action-status" role="status">{status}</div>}
    </div>
  );
}

