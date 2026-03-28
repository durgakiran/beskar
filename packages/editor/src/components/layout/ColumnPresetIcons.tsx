import React from 'react';

export type ColumnPresetIconVariant =
  | 'equal2'
  | 'sidebarRight2'
  | 'sidebarLeft2'
  | 'equal3'
  | 'wideCenter3';

/**
 * Small diagram icons for column width presets (Confluence-style vertical bars).
 */
export function ColumnPresetIcon({
  variant,
  className,
}: {
  variant: ColumnPresetIconVariant;
  className?: string;
}) {
  const f = { fill: 'currentColor' as const, opacity: 0.45 };
  switch (variant) {
    case 'equal2':
      return (
        <svg
          className={className}
          width={22}
          height={14}
          viewBox="0 0 22 14"
          aria-hidden
        >
          <rect x="1" y="1.5" width="9" height="11" rx="1" {...f} />
          <rect x="12" y="1.5" width="9" height="11" rx="1" {...f} />
        </svg>
      );
    case 'sidebarRight2':
      return (
        <svg
          className={className}
          width={22}
          height={14}
          viewBox="0 0 22 14"
          aria-hidden
        >
          <rect x="1" y="1.5" width="12.5" height="11" rx="1" {...f} />
          <rect x="14.5" y="1.5" width="6.5" height="11" rx="1" {...f} />
        </svg>
      );
    case 'sidebarLeft2':
      return (
        <svg
          className={className}
          width={22}
          height={14}
          viewBox="0 0 22 14"
          aria-hidden
        >
          <rect x="1" y="1.5" width="6.5" height="11" rx="1" {...f} />
          <rect x="8.5" y="1.5" width="12.5" height="11" rx="1" {...f} />
        </svg>
      );
    case 'equal3':
      return (
        <svg
          className={className}
          width={24}
          height={14}
          viewBox="0 0 24 14"
          aria-hidden
        >
          <rect x="1" y="1.5" width="6" height="11" rx="0.5" {...f} />
          <rect x="9" y="1.5" width="6" height="11" rx="0.5" {...f} />
          <rect x="17" y="1.5" width="6" height="11" rx="0.5" {...f} />
        </svg>
      );
    case 'wideCenter3':
      return (
        <svg
          className={className}
          width={24}
          height={14}
          viewBox="0 0 24 14"
          aria-hidden
        >
          <rect x="1" y="1.5" width="4" height="11" rx="0.5" {...f} />
          <rect x="6.5" y="1.5" width="11" height="11" rx="0.5" {...f} />
          <rect x="19" y="1.5" width="4" height="11" rx="0.5" {...f} />
        </svg>
      );
    default:
      return null;
  }
}
