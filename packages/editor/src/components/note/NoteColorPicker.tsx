/**
 * NoteColorPicker - Color picker for note block backgrounds
 * Similar to table ColorPicker but optimized for note blocks
 */

import React, { useState } from 'react';

export const PRESET_COLORS = [
  '#e9f2ff', // blue
  '#f3f0ff', // purple
  '#e3fcef', // green
  '#fffae6', // yellow
  '#ffebe9', // red
  '#f5f5f5', // gray
  '#fff',    // white
  '#e0f2fe', // sky
  '#fef3c7', // amber
  '#fce7f3', // pink
  '#f3e8ff', // violet
  '#d1fae5', // emerald
];

export interface NoteColorPickerProps {
  currentColor?: string;
  onColorChange: (color: string) => void;
}

export function NoteColorPicker({ currentColor, onColorChange }: NoteColorPickerProps) {
  const [customColor, setCustomColor] = useState(currentColor || '#f3f0ff');

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCustomColor(value);
  };

  const handleCustomColorBlur = () => {
    if (customColor && /^#[0-9A-F]{6}$/i.test(customColor)) {
      onColorChange(customColor);
    }
  };

  const handleCustomColorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCustomColorBlur();
    }
  };

  return (
    <div className="note-color-picker">
      <div className="color-grid">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            className={`color-swatch ${currentColor === color ? 'active' : ''}`}
            style={{ backgroundColor: color }}
            onClick={() => onColorChange(color)}
            type="button"
            title={color}
            aria-label={`Select color ${color}`}
          />
        ))}
      </div>
      <div className="custom-color-input">
        <label htmlFor="custom-color">Custom:</label>
        <input
          id="custom-color"
          type="text"
          value={customColor}
          onChange={handleCustomColorChange}
          onBlur={handleCustomColorBlur}
          onKeyDown={handleCustomColorKeyDown}
          placeholder="#f3f0ff"
          pattern="^#[0-9A-Fa-f]{6}$"
        />
        <button
          type="button"
          onClick={handleCustomColorBlur}
          className="apply-custom-color"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

