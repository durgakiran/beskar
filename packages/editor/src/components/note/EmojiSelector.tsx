import React, { useMemo, useState } from 'react';
import { gitHubEmojis } from '@tiptap/extension-emoji';

export interface EmojiSelectorProps {
  onSelect: (emoji: string) => void;
}

export function EmojiSelector({ onSelect }: EmojiSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

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

  const displayEmojis = useMemo(() => {
    if (!searchQuery.trim()) return commonEmojis;

    const query = searchQuery.toLowerCase().trim();
    return gitHubEmojis
      .filter((e) => {
        if (!e.emoji || typeof e.emoji !== 'string') return false;
        return (
          e.name.includes(query) ||
          e.tags?.some((tag) => tag.toLowerCase().includes(query)) ||
          e.shortcodes?.some((code) => code.toLowerCase().includes(query))
        );
      })
      .slice(0, 30) // limit results to keep grid size reasonable
      .map((e) => e.emoji)
      .filter((emoji): emoji is string => typeof emoji === 'string' && emoji.length > 0);
  }, [searchQuery, commonEmojis]);

  return (
    <div className="note-emoji-selector" style={{ color: 'var(--editor-text-primary, #1f1f1f)' }}>
      <div className="emoji-input-wrapper" style={{ marginBottom: '12px' }}>
        <input
          type="text"
          className="emoji-input"
          placeholder="Search emojis..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="emoji-grid">
        {displayEmojis.length > 0 ? (
          displayEmojis.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              className="emoji-button"
              onClick={() => {
                onSelect(emoji);
                setSearchQuery('');
              }}
              type="button"
              title={emoji}
            >
              {emoji}
            </button>
          ))
        ) : (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '16px 0', color: 'var(--editor-text-tertiary, #6b7280)', fontSize: '14px' }}>
            No emojis found
          </div>
        )}
      </div>
    </div>
  );
}

