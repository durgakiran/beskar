export const STATUS_BADGE_COLORS = ['gray', 'blue', 'green', 'yellow', 'red'] as const;
export type StatusBadgeColor = (typeof STATUS_BADGE_COLORS)[number];

export function parseStatusBadgeColor(value: string | null): StatusBadgeColor {
  if (value && STATUS_BADGE_COLORS.includes(value as StatusBadgeColor)) {
    return value as StatusBadgeColor;
  }
  return 'gray';
}
