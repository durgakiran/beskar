/**
 * ThemePresets - Predefined theme options for note blocks
 */

import React from 'react';
import { FiInfo, FiFileText, FiCheckCircle, FiAlertTriangle, FiXCircle } from 'react-icons/fi';

export interface Theme {
  name: 'info' | 'note' | 'success' | 'warning' | 'error';
  label: string;
  icon: 'info' | 'note' | 'success' | 'warning' | 'error';
  backgroundColor: string;
  IconComponent: React.ComponentType<{ size?: number; color?: string }>;
  iconColor: string;
}

export const THEME_PRESETS: Theme[] = [
  {
    name: 'info',
    label: 'Info',
    icon: 'info',
    backgroundColor: '#e9f2ff',
    IconComponent: FiInfo,
    iconColor: '#0c66e4',
  },
  {
    name: 'note',
    label: 'Note',
    icon: 'note',
    backgroundColor: '#f3f0ff',
    IconComponent: FiFileText,
    iconColor: '#6e5dc6',
  },
  {
    name: 'success',
    label: 'Success',
    icon: 'success',
    backgroundColor: '#e3fcef',
    IconComponent: FiCheckCircle,
    iconColor: '#1f845a',
  },
  {
    name: 'warning',
    label: 'Warning',
    icon: 'warning',
    backgroundColor: '#fffae6',
    IconComponent: FiAlertTriangle,
    iconColor: '#cf9f02',
  },
  {
    name: 'error',
    label: 'Error',
    icon: 'error',
    backgroundColor: '#ffebe9',
    IconComponent: FiXCircle,
    iconColor: '#c9372c',
  },
];

export interface ThemePresetsProps {
  onSelect: (theme: Theme) => void;
}

export function ThemePresets({ onSelect }: ThemePresetsProps) {
  return (
    <div className="note-theme-presets">
      {THEME_PRESETS.map((theme) => (
        <button
          key={theme.name}
          className="note-theme-item"
          onClick={() => onSelect(theme)}
          type="button"
        >
          <div 
            className="note-theme-icon" 
            style={{ backgroundColor: theme.backgroundColor }}
          >
            <theme.IconComponent size={18} color={theme.iconColor} />
          </div>
          <span className="note-theme-label">{theme.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Get the IconComponent for a given icon name
 */
export function getIconComponent(icon: string): React.ComponentType<{ size?: number; color?: string }> | null {
  const theme = THEME_PRESETS.find((t) => t.icon === icon);
  return theme ? theme.IconComponent : null;
}

/**
 * Get theme by name
 */
export function getTheme(name: string): Theme | undefined {
  return THEME_PRESETS.find((t) => t.name === name);
}

