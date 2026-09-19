import { useEffect, useState } from 'react';
import { getTodayDateValue } from '../../nodes/dateInlineUtils';

/** Refresh display-only labels across midnight, clock changes, and sleeping tabs. */
export function useLocalToday(): string {
  const [today, setToday] = useState(getTodayDateValue);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      setToday(getTodayDateValue());
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      // Calendar midnight handles DST; the minute cap also catches clock/timezone changes.
      timer = setTimeout(refresh, Math.min(60_000, midnight.getTime() - now.getTime()));
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return today;
}
