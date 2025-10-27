/**
 * EmojiSelector - Simple emoji picker for note block icons
 * Uses GitHub emojis from TipTap emoji extension
 */

import React, { useMemo } from 'react';
import { gitHubEmojis } from '@tiptap/extension-emoji';

export interface EmojiSelectorProps {
  onSelect: (emoji: string) => void;
}

export function EmojiSelector({ onSelect }: EmojiSelectorProps) {
  // Get a curated list of commonly used emojis from gitHubEmojis
  const commonEmojiNames = [
    'memo', 'bulb', 'warning', 'x', 'white_check_mark',
    'pushpin', 'bell', 'speech_balloon', 'clipboard', 'dart',
    'fire', 'star', '100', 'rocket', 'loudspeaker',
    'lock', 'unlock', 'mag', 'bar_chart', 'chart_with_upwards_trend',
    'floppy_disk', 'computer', 'iphone', 'globe_with_meridians', 'gear',
    'art', 'books', 'trophy', 'muscle', 'thumbsup',
  ];

  const commonEmojis = useMemo(() => {
    return commonEmojiNames
      .map((name) => gitHubEmojis.find((e) => e.name === name))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((e) => e.emoji)
      .filter((emoji): emoji is string => typeof emoji === 'string' && emoji.length > 0);
  }, []);

  return (
    <div className="note-emoji-selector">
      <div className="emoji-grid">
        {commonEmojis.map((emoji, index) => (
          <button
            key={`${emoji}-${index}`}
            className="emoji-button"
            onClick={() => onSelect(emoji)}
            type="button"
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="emoji-input-wrapper">
        <input
          type="text"
          className="emoji-input"
          placeholder="Or paste emoji..."
          maxLength={2}
          onChange={(e) => {
            const value = e.target.value.trim();
            if (value) {
              onSelect(value);
              e.target.value = '';
            }
          }}
        />
      </div>
    </div>
  );
}

