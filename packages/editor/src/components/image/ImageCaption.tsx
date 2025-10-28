/**
 * ImageCaption - Caption editor for image blocks
 */

import React, { useState, useEffect } from 'react';
import type { Editor } from '@tiptap/core';

interface ImageCaptionProps {
  caption: string;
  editor: Editor;
  onCaptionChange: (caption: string) => void;
}

export function ImageCaption({ caption, editor, onCaptionChange }: ImageCaptionProps) {
  const [localCaption, setLocalCaption] = useState(caption);

  useEffect(() => {
    setLocalCaption(caption);
  }, [caption]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newCaption = e.target.value;
    setLocalCaption(newCaption);
  };

  const handleBlur = () => {
    if (localCaption !== caption) {
      onCaptionChange(localCaption);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
    // Stop propagation to prevent editor shortcuts
    e.stopPropagation();
  };

  return (
    <input
      type="text"
      className="image-block-caption"
      value={localCaption}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="Add a caption..."
      contentEditable={editor.isEditable}
      disabled={!editor.isEditable}
    />
  );
}

