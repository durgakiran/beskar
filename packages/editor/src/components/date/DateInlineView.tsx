/**
 * DateInlineView — inline date pill with Radix popover editing.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Button, Flex, Text } from '@radix-ui/themes';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useLocalToday } from './useLocalToday';
import { TextSelection } from '@tiptap/pm/state';
import {
  INVALID_DATE_LABEL,
  addMonths,
  addDaysToDateValue,
  formatCalendarMonthLabel,
  formatDateLabel,
  formatRelativeDateLabel,
  getCalendarMonthDays,
  getMonthStart,
  getTodayDateValue,
  isSameCalendarDay,
  isValidDateValue,
  parseDateValue,
  toLocalDateValue,
} from '../../nodes/dateInlineUtils';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function placeCursorAfterDate(
  editor: NodeViewProps['editor'],
  getPos: NodeViewProps['getPos'],
  node: NodeViewProps['node']
) {
  const pos = typeof getPos === 'function' ? getPos() : null;
  if (pos == null || pos < 0) return;

  const after = pos + node.nodeSize;
  const { doc } = editor.state;

  if (after >= doc.content.size) {
    editor
      .chain()
      .focus()
      .insertContentAt(after, { type: 'paragraph' })
      .setTextSelection(after + 1)
      .run();
    return;
  }

  const tr = editor.state.tr.setSelection(TextSelection.create(doc, after));
  editor.view.dispatch(tr);
  editor.view.focus();
}

export function DateInlineView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const value = String(node.attrs.value ?? '');
  const isValidValue = isValidDateValue(value);
  const today = useLocalToday();
  const absoluteLabel = formatDateLabel(value);
  const label = formatRelativeDateLabel(value, today);
  const accessibleLabel = label === absoluteLabel ? `Date: ${label}` : `Date: ${label}, ${absoluteLabel}`;
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(isValidValue ? value : '');
  const initialMonth = useMemo(() => {
    const current = parseDateValue(value) ?? new Date();
    return getMonthStart(current);
  }, [value]);
  const [visibleMonth, setVisibleMonth] = useState(initialMonth);
  const calendarRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const [dateError, setDateError] = useState(false);
  const [focusedDay, setFocusedDay] = useState(isValidValue ? value : getTodayDateValue());
  const focusPending = useRef(false);
  const selectedDate = useMemo(() => parseDateValue(inputValue), [inputValue]);
  const todayDate = parseDateValue(today);
  const monthDays = useMemo(() => getCalendarMonthDays(visibleMonth), [visibleMonth]);
  const portalContainer = useMemo(() => {
    const root = editor.view.dom.closest('.radix-themes');
    return root instanceof HTMLElement ? root : undefined;
  }, [editor]);

  useEffect(() => {
    if (open) {
      setInputValue(isValidValue ? value : '');
      setDateError(false);
      setFocusedDay(isValidValue ? value : getTodayDateValue());
      setVisibleMonth(getMonthStart(parseDateValue(value) ?? new Date()));
    }
  }, [open, isValidValue, value]);

  useEffect(() => {
    if (open && calendarRef.current) {
      const id = requestAnimationFrame(() => {
        calendarRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const commitValue = useCallback(
    (nextValue: string) => {
      if (!isValidDateValue(nextValue)) {
        return false;
      }
      updateAttributes({ value: nextValue });
      return true;
    },
    [updateAttributes]
  );

  const removeNode = useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos == null || pos < 0) return;

    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    setOpen(false);
    requestAnimationFrame(() => {
      editor.view.focus();
    });
  }, [editor, getPos, node.nodeSize]);

  // Date selections save immediately; closing never rolls back a saved value.
  const finishClose = useCallback(() => {
    // Outside interaction can unmount the input before its blur handler runs.
    if (isValidDateValue(inputValue) && inputValue !== value) commitValue(inputValue);
    setOpen(false);
    requestAnimationFrame(() => placeCursorAfterDate(editor, getPos, node));
  }, [commitValue, editor, getPos, inputValue, node, value]);

  const applyTypedDate = () => {
    if (!commitValue(inputValue)) {
      setDateError(true);
      return;
    }
    setDateError(false);
    setFocusedDay(inputValue);
    setVisibleMonth(getMonthStart(parseDateValue(inputValue)!));
  };

  useEffect(() => {
    if (open && focusPending.current) {
      calendarRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDay}"]`)?.focus();
      focusPending.current = false;
    }
  }, [open, focusedDay, visibleMonth]);

  const navigateDay = (event: React.KeyboardEvent, day: Date) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
      Home: -day.getDay(), End: 6 - day.getDay(),
    };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = addDaysToDateValue(toLocalDateValue(day), offsets[event.key]);
    if (!isValidDateValue(next)) return;
    focusPending.current = true;
    setFocusedDay(next);
    setVisibleMonth(getMonthStart(parseDateValue(next)!));
  };

  const tabStop = monthDays.some(day => day && toLocalDateValue(day) === focusedDay)
    ? focusedDay : toLocalDateValue(visibleMonth);

  const wrapperClassName = useMemo(() => {
    const classes = ['date-inline'];
    if (!isValidValue) classes.push('date-inline--invalid');
    if (open) classes.push('date-inline--selected');
    return classes.join(' ');
  }, [isValidValue, open]);

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper
        as="span"
        className="date-inline-wrapper date-inline-wrapper--readonly"
        contentEditable={false}
      >
        <span className={wrapperClassName} role="img" aria-label={accessibleLabel} title={absoluteLabel}>
          {label}
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="date-inline-wrapper" contentEditable={false}>
      <Popover.Root open={open} onOpenChange={(next) => next && setOpen(true)} modal={false}>
        <Popover.Trigger asChild>
          <span
            className={wrapperClassName}
            role="button"
            tabIndex={0}
            aria-label={accessibleLabel} title={absoluteLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!open) setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(true);
              }
            }}
          >
            {label}
          </span>
        </Popover.Trigger>
        <Popover.Portal container={portalContainer}>
          <Popover.Content
            className="date-inline-popover"
            side="top"
            sideOffset={6}
            align="center"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              finishClose();
            }}
            onInteractOutside={(e) => {
              e.preventDefault();
              finishClose();
            }}
          >
            <label htmlFor={inputId}>Date (YYYY-MM-DD)</label>
            <input
              id={inputId}
              className="date-inline-input"
              type="text"
              placeholder="YYYY-MM-DD"
              value={inputValue}
              aria-invalid={dateError}
              aria-describedby={dateError ? `${inputId}-error` : undefined}
              onChange={(event) => { setInputValue(event.target.value); setDateError(false); }}
              onBlur={applyTypedDate}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); applyTypedDate(); }
              }}
            />
            {dateError && <Text id={`${inputId}-error`} size="1" color="red" role="alert">Enter a valid date as YYYY-MM-DD.</Text>}
            {!isValidValue && (
              <Text as="p" size="1" className="date-inline-popover__warning" role="status">
                {INVALID_DATE_LABEL}. Pick a new date or clear it.
              </Text>
            )}
            <Flex align="center" justify="between" gap="2">
              <Button
                type="button"
                size="1"
                variant="soft"
                color="gray"
                onPointerDown={(e) => e.preventDefault()}
                disabled={visibleMonth.getFullYear() === 1 && visibleMonth.getMonth() === 0}
                onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
                aria-label="Previous month"
              >
                Prev
              </Button>
              <Text size="2" weight="medium" className="date-inline-month-label">
                {formatCalendarMonthLabel(visibleMonth)}
              </Text>
              <Button
                type="button"
                size="1"
                variant="soft"
                color="gray"
                onPointerDown={(e) => e.preventDefault()}
                disabled={visibleMonth.getFullYear() === 9999 && visibleMonth.getMonth() === 11}
                onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                aria-label="Next month"
              >
                Next
              </Button>
            </Flex>
            <label className="date-inline-year-label">
              Year
              <input
                key={visibleMonth.getFullYear()}
                aria-label="Calendar year"
                className="date-inline-year"
                type="number"
                min={1}
                max={9999}
                defaultValue={visibleMonth.getFullYear()}
                onBlur={(event) => {
                  const year = Number(event.target.value);
                  if (Number.isInteger(year) && year >= 1 && year <= 9999) {
                    const next = new Date(visibleMonth);
                    next.setFullYear(year);
                    setVisibleMonth(next);
                  } else {
                    event.target.value = String(visibleMonth.getFullYear());
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                }}
              />
            </label>
            <div
              ref={calendarRef}
              className="date-inline-calendar"
              role="group"
              aria-label="Date picker calendar"
            >
              {WEEKDAY_LABELS.map((weekday) => (
                <Text key={weekday} as="span" size="1" className="date-inline-calendar__weekday">
                  {weekday}
                </Text>
              ))}
              {monthDays.map((day, index) => {
                if (!day) {
                  return <span key={`empty-${index}`} className="date-inline-calendar__empty" aria-hidden="true" />;
                }

                const dayValue = toLocalDateValue(day);
                const isSelected = selectedDate ? isSameCalendarDay(day, selectedDate) : false;
                const isToday = todayDate ? isSameCalendarDay(day, todayDate) : false;

                return (
                  <button
                    key={dayValue}
                    type="button"
                    className={`date-inline-calendar__day${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                    data-date={dayValue}
                    tabIndex={dayValue === tabStop ? 0 : -1}
                    aria-label={formatDateLabel(dayValue)}
                    aria-current={isToday ? 'date' : undefined}
                    aria-pressed={isSelected}
                    onFocus={() => setFocusedDay(dayValue)}
                    onKeyDown={(event) => navigateDay(event, day)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setInputValue(dayValue);
                      commitValue(dayValue);
                    }}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
            <Text size="1" color="gray">Changes save immediately. Escape closes.</Text>
            <Text size="1" color="gray">
              {selectedDate ? `Selected: ${formatDateLabel(inputValue)}` : 'No date selected'}
            </Text>
            <Flex gap="2" align="center" wrap="wrap" role="group" aria-label="Date shortcuts">
              <Button
                type="button"
                size="1"
                variant="soft"
                color="gray"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  const today = getTodayDateValue();
                  setInputValue(today);
                  commitValue(today);
                }}
              >
                Today
              </Button>
              <Button
                type="button"
                size="1"
                variant="soft"
                color="gray"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  const tomorrow = addDaysToDateValue(getTodayDateValue(), 1);
                  setInputValue(tomorrow);
                  commitValue(tomorrow);
                }}
              >
                Tomorrow
              </Button>
              <Button
                type="button"
                size="1"
                variant="soft"
                color="red"
                onPointerDown={(e) => e.preventDefault()}
                onClick={removeNode}
              >
                Clear
              </Button>
            </Flex>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </NodeViewWrapper>
  );
}
