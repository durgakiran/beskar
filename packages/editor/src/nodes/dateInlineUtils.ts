export const INVALID_DATE_LABEL = 'Invalid date';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toLocalDateValue(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getTodayDateValue(): string {
  return toLocalDateValue(new Date());
}

export function addDaysToDateValue(value: string, days: number): string {
  if (!isValidDateValue(value)) {
    return getTodayDateValue();
  }

  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(0);
  next.setHours(0, 0, 0, 0);
  next.setFullYear(year, month - 1, day);
  next.setDate(next.getDate() + days);
  return toLocalDateValue(next);
}

export function isValidDateValue(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);

  return (
    year >= 1 &&
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

export function parseDateValue(value: string | null | undefined): Date | null {
  if (!isValidDateValue(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

export function getMonthStart(date: Date): Date {
  const start = new Date(date);
  start.setDate(1);
  return start;
}

export function addMonths(date: Date, months: number): Date {
  const next = getMonthStart(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function getCalendarMonthDays(month: Date): Array<Date | null> {
  const start = getMonthStart(month);
  const startWeekday = start.getDay();
  const end = addMonths(start, 1);
  end.setDate(0);
  const daysInMonth = end.getDate();
  const cells: Array<Date | null> = [];

  for (let i = 0; i < startWeekday; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cell = new Date(start);
    cell.setDate(day);
    cells.push(cell);
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

export function formatCalendarMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!isValidDateValue(value)) {
    return INVALID_DATE_LABEL;
  }

  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

/** Relative labels are presentation only; persisted/exported dates stay absolute. */
export function formatRelativeDateLabel(
  value: string | null | undefined,
  today: string = getTodayDateValue()
): string {
  if (isValidDateValue(value) && isValidDateValue(today)) {
    if (value === today) return 'Today';
    if (value === addDaysToDateValue(today, 1)) return 'Tomorrow';
    if (value === addDaysToDateValue(today, -1)) return 'Yesterday';
  }
  return formatDateLabel(value);
}
