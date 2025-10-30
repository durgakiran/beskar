/**
 * TextColorPicker - Simple color picker for text and highlight colors
 */

import React, { useState, useRef, useEffect } from 'react';
import './TextColorPicker.css';

export interface TextColorPickerProps {
  onColorSelect: (color: string) => void;
  currentColor?: string;
  label?: string;
  icon?: 'text' | 'highlight';
}

const PRESET_COLORS = [
  // Text colors
  '#000000', '#374151', '#6B7280', '#9CA3AF',
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1',
  '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
];

const HIGHLIGHT_COLORS = [
  // Background/highlight colors (lighter shades)
  'transparent',
  '#FEE2E2', '#FFEDD5', '#FEF3C7', '#FEF9C3',
  '#ECFCCB', '#D1FAE5', '#D1F2EB', '#CCFBF1',
  '#CFFAFE', '#DBEAFE', '#DBEAFE', '#E0E7FF',
  '#EDE9FE', '#F3E8FF', '#FAE8FF', '#FCE7F3',
];

export function TextColorPicker({ onColorSelect, currentColor, label }: TextColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
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
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const colors = label?.toLowerCase().includes('highlight') ? HIGHLIGHT_COLORS : PRESET_COLORS;

  const isHighlight = label?.toLowerCase().includes('highlight');
  const displayColor = currentColor || (isHighlight ? 'transparent' : '#000000');

  return (
    <div className="color-picker" ref={pickerRef}>
      <button
        className="color-picker-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={label || 'Choose color'}
        type="button"
      >
        <div 
          className="color-picker-indicator"
          style={{
            backgroundColor: displayColor === 'transparent' ? 'white' : displayColor,
            border: displayColor === 'transparent' ? '1px solid #d1d5db' : 'none',
          }}
        >
          {displayColor === 'transparent' && (
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>A</span>
          )}
        </div>
      </button>
      
      {isOpen && (
        <div className="color-picker-popover">
          {label && <div className="color-picker-label">{label}</div>}
          
          <div className="color-picker-grid">
            {colors.map((color) => (
              <button
                key={color}
                className={`color-picker-swatch ${currentColor === color ? 'active' : ''}`}
                style={{
                  backgroundColor: color === 'transparent' ? 'white' : color,
                  border: color === 'transparent' ? '1px solid #e5e7eb' : 'none',
                }}
                onClick={() => {
                  onColorSelect(color);
                  setIsOpen(false);
                }}
                title={color === 'transparent' ? 'No color' : color}
                type="button"
              >
                {color === 'transparent' && (
                  <span style={{ fontSize: '16px', color: '#ef4444' }}>✕</span>
                )}
              </button>
            ))}
          </div>
          
          {/* Remove color button */}
          <button
            className="color-picker-remove"
            onClick={() => {
              onColorSelect('');
              setIsOpen(false);
            }}
            type="button"
          >
            Remove Color
          </button>
        </div>
      )}
    </div>
  );
}

