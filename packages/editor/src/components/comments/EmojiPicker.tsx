import React, { useState, useRef, useEffect } from 'react';
import { FiSmile } from 'react-icons/fi';
import './EmojiPicker.css';

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  currentReactions?: ReactionSummary[];
  currentUserId?: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
  hasReacted: boolean;
}

// Common emoji reactions
const COMMON_EMOJIS = ['👍', '❤️', '😄', '🎉', '👏', '🔥', '💯', '✨', '🙌', '😊', '😍', '🤔', '👀', '💡', '✅'];

export function EmojiPicker({ onSelect, currentReactions = [], currentUserId }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredEmoji, setHoveredEmoji] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
    setIsOpen(false);
  };

  // Get reaction count for emoji
  const getReactionCount = (emoji: string): number => {
    const reaction = currentReactions.find((r) => r.emoji === emoji);
    return reaction?.count || 0;
  };

  // Check if user has reacted
  const hasUserReacted = (emoji: string): boolean => {
    const reaction = currentReactions.find((r) => r.emoji === emoji);
    return reaction?.hasReacted || false;
  };

  return (
    <div className="emoji-picker-wrapper" ref={pickerRef}>
      <button
        className="emoji-picker-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Add emoji reaction"
      >
        <FiSmile />
      </button>
      {isOpen && (
        <div className="emoji-picker-popup">
          <div className="emoji-picker-header">Add Reaction</div>
          <div className="emoji-picker-grid">
            {COMMON_EMOJIS.map((emoji) => {
              const count = getReactionCount(emoji);
              const hasReacted = hasUserReacted(emoji);
              return (
                <button
                  key={emoji}
                  className={`emoji-picker-item ${hasReacted ? 'has-reacted' : ''} ${
                    hoveredEmoji === emoji ? 'hovered' : ''
                  }`}
                  onClick={() => handleEmojiClick(emoji)}
                  onMouseEnter={() => setHoveredEmoji(emoji)}
                  onMouseLeave={() => setHoveredEmoji(null)}
                  title={emoji}
                >
                  <span className="emoji">{emoji}</span>
                  {count > 0 && (
                    <span className="emoji-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

