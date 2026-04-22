/**
 * DateInlineView — inline date pill with Radix popover editing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Button, Flex, Text } from '@radix-ui/themes';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import {
  INVALID_DATE_LABEL,
  addMonths,
  addDaysToDateValue,
  formatCalendarMonthLabel,
  formatDateLabel,
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
  const label = formatDateLabel(value);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(isValidValue ? value : '');
  const initialMonth = useMemo(() => {
    const current = parseDateValue(value) ?? new Date();
    return getMonthStart(current);
  }, [value]);
  const [visibleMonth, setVisibleMonth] = useState(initialMonth);
  const calendarRef = useRef<HTMLDivElement>(null);
  const selectedDate = useMemo(() => parseDateValue(inputValue), [inputValue]);
  const todayDate = useMemo(() => parseDateValue(getTodayDateValue()), []);
  const monthDays = useMemo(() => getCalendarMonthDays(visibleMonth), [visibleMonth]);
  const portalContainer = useMemo(() => {
    const root = editor.view.dom.closest('.radix-themes');
    return root instanceof HTMLElement ? root : undefined;
  }, [editor]);

  useEffect(() => {
    if (open) {
      setInputValue(isValidValue ? value : '');
      setVisibleMonth(getMonthStart(parseDateValue(value) ?? new Date()));
    }
  }, [open, isValidValue, value]);

  useEffect(() => {
    if (open && calendarRef.current) {
      const id = requestAnimationFrame(() => {
        calendarRef.current?.focus();
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

  const finishClose = useCallback(
    (mode: 'commit' | 'discard') => {
      if (mode === 'commit' && inputValue) {
        if (!commitValue(inputValue)) return;
      }

      setOpen(false);
      requestAnimationFrame(() => {
        placeCursorAfterDate(editor, getPos, node);
      });
    },
    [commitValue, editor, getPos, inputValue, node]
  );

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
        <span className={wrapperClassName} role="img" aria-label={`Date: ${label}`}>
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
            aria-label={`Date: ${label}`}
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
              finishClose('discard');
            }}
            onInteractOutside={(e) => {
              e.preventDefault();
              finishClose('commit');
            }}
          >
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
                onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                aria-label="Next month"
              >
                Next
              </Button>
            </Flex>
            <div
              ref={calendarRef}
              className="date-inline-calendar"
              role="grid"
              aria-label="Date picker calendar"
              tabIndex={-1}
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
                    aria-pressed={isSelected}
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
                  const base = isValidDateValue(inputValue) ? inputValue : getTodayDateValue();
                  const tomorrow = addDaysToDateValue(base, 1);
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
