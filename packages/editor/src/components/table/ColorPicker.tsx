import React, { useState } from 'react';
import { Editor } from '@tiptap/react';
import { setCellBackgroundColor } from '../../nodes/table/utils';

interface ColorPickerProps {
  editor: Editor;
}

const PRESET_COLORS = [
  { name: 'Default', value: null },
  { name: 'Light Gray', value: '#f3f4f6' },
  { name: 'Gray', value: '#e5e7eb' },
  { name: 'Red', value: '#fecaca' },
  { name: 'Orange', value: '#fed7aa' },
  { name: 'Yellow', value: '#fef08a' },
  { name: 'Green', value: '#bbf7d0' },
  { name: 'Blue', value: '#bfdbfe' },
  { name: 'Purple', value: '#e9d5ff' },
  { name: 'Pink', value: '#fbcfe8' },
];

export const ColorPicker: React.FC<ColorPickerProps> = ({ editor }) => {
  const [customColor, setCustomColor] = useState('');

  const applyColor = (color: string | null) => {
    const { state, view } = editor;
    const tr = setCellBackgroundColor(color)(state.tr);
    view.dispatch(tr);
  };

  const handleCustomColor = () => {
    if (customColor) {
      applyColor(customColor);
      setCustomColor('');
    }
  };

  return (
    <div className="table-color-picker-wrapper">
      <div className="table-color-picker">
            <div className="color-grid">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.name}
                  className="color-swatch"
                  style={{
                    backgroundColor: color.value || 'transparent',
                    border: color.value ? 'none' : '1px solid #e5e7eb',
                  }}
                  onClick={() => applyColor(color.value)}
                  title={color.name}
                  aria-label={color.name}
                >
                  {!color.value && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <line
                        x1="2"
                        y1="14"
                        x2="14"
                        y2="2"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <div className="custom-color-input">
              <input
                type="text"
                placeholder="#000000"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCustomColor();
                  }
                }}
              />
              <button onClick={handleCustomColor}>Apply</button>
            </div>
          </div>
        </div>
  );
};

