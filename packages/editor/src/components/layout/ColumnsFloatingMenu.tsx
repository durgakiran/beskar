import React, { useCallback } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import { FiCopy, FiTrash2, FiChevronDown } from 'react-icons/fi';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { copyColumnsBlock, deleteColumnsLayout } from './utils';
import { ColumnPresetIcon } from './ColumnPresetIcons';

export interface ColumnsFloatingMenuProps {
  editor: Editor;
  getPos: (() => number | undefined) | boolean;
  columnsNode: PMNode;
}

function normalizeWidth(w: unknown): number | null {
  if (w == null || w === '') return null;
  const n = Number(w);
  return Number.isFinite(n) ? n : null;
}

function matchesPreset(node: PMNode, widths: (number | null)[]): boolean {
  if (node.childCount !== widths.length) return false;
  for (let i = 0; i < widths.length; i++) {
    if (normalizeWidth(node.child(i).attrs.width) !== widths[i]) return false;
  }
  return true;
}

const PRESET_EQUAL_2: (number | null)[] = [null, null];
const PRESET_SIDEBAR_RIGHT: (number | null)[] = [67, 33];
const PRESET_SIDEBAR_LEFT: (number | null)[] = [33, 67];
const PRESET_EQUAL_3: (number | null)[] = [null, null, null];
const PRESET_WIDE_CENTER: (number | null)[] = [25, 50, 25];

export function ColumnsFloatingMenu({ editor, getPos, columnsNode }: ColumnsFloatingMenuProps) {
  const columnCount = columnsNode.attrs.columnCount === 3 ? 3 : 2;

  const getColumnsPos = useCallback((): number | undefined => {
    if (typeof getPos !== 'function') return undefined;
    return getPos();
  }, [getPos]);

  const dispatchPreset = useCallback(
    (widths: (number | null)[]) => {
      const pos = getColumnsPos();
      if (pos === undefined || pos < 0) return;
      const { state } = editor;
      const fresh = state.doc.nodeAt(pos);
      if (!fresh || fresh.type.name !== 'columns' || fresh.childCount !== widths.length) return;

      const tr = state.tr;
      let childPos = pos + 1;
      for (let i = 0; i < widths.length; i++) {
        const child = fresh.child(i);
        const w = widths[i];
        tr.setNodeMarkup(childPos, undefined, {
          ...child.attrs,
          width: w,
        });
        childPos += child.nodeSize;
      }
      editor.view.dispatch(tr);
    },
    [editor, getColumnsPos]
  );

  const convertToTwo = useCallback(() => {
    const pos = getColumnsPos();
    if (pos === undefined || pos < 0) return;
    const { state } = editor;
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'columns' || node.childCount !== 3) return;

    const schema = state.schema;
    const col0 = node.child(0);
    const col1 = node.child(1);
    const col2 = node.child(2);
    const pos1 = pos + 1 + col0.nodeSize;
    const pos2 = pos1 + col1.nodeSize;

    const merged: PMNode[] = [];
    col1.forEach((c) => {
      merged.push(c);
    });
    merged.push(schema.nodes.paragraph.create());
    col2.forEach((c) => {
      merged.push(c);
    });

    const newCol1 = schema.nodes.column.create(
      { ...col1.attrs, width: null },
      Fragment.from(merged)
    );

    const tr = state.tr;
    tr.replaceWith(pos1, pos2 + col2.nodeSize, newCol1);
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      columnCount: 2,
    });
    editor.view.dispatch(tr);
  }, [editor, getColumnsPos]);

  const convertToThree = useCallback(() => {
    const pos = getColumnsPos();
    if (pos === undefined || pos < 0) return;
    const { state } = editor;
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'columns' || node.childCount !== 2) return;

    const schema = state.schema;
    const col0 = node.child(0);
    const col1 = node.child(1);
    const pos0 = pos + 1;
    const insertPos = pos0 + col0.nodeSize + col1.nodeSize;

    const newCol = schema.nodes.column.create(
      { width: null, blockId: crypto.randomUUID() },
      Fragment.from(schema.nodes.paragraph.create())
    );

    const tr = state.tr;
    tr.insert(insertPos, newCol);
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      columnCount: 3,
    });
    editor.view.dispatch(tr);
  }, [editor, getColumnsPos]);

  const handleCopy = () => {
    copyColumnsBlock(editor, getPos, (columnsNode.attrs.blockId as string | null) ?? null);
  };

  const handleDelete = () => {
    deleteColumnsLayout(editor, getPos, (columnsNode.attrs.blockId as string | null) ?? null);
  };

  /** ProseMirror loses the in-layout selection on mousedown unless default is prevented. */
  const keepEditorSelection = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const layoutLabel = columnCount === 3 ? '3 columns' : '2 columns';

  return (
    <Toolbar.Root className="editor-floating-toolbar">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="editor-floating-toolbar-button columns-layout-dropdown-trigger"
            title="Column count"
            aria-label="Column count"
            onMouseDown={keepEditorSelection}
          >
            <span>{layoutLabel}</span>
            <FiChevronDown size={14} aria-hidden className="columns-layout-dropdown-chevron" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="note-dropdown-content columns-layout-dropdown-content"
            sideOffset={6}
            align="start"
          >
            <DropdownMenu.Item
              className="note-dropdown-item"
              disabled={columnCount === 2}
              onSelect={() => convertToTwo()}
            >
              2 columns
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="note-dropdown-item"
              disabled={columnCount === 3}
              onSelect={() => convertToThree()}
            >
              3 columns
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" decorative />

      {columnCount === 2 && (
        <>
          <Toolbar.Button
            type="button"
            className="editor-floating-toolbar-toggle columns-preset-icon-btn"
            data-state={matchesPreset(columnsNode, PRESET_EQUAL_2) ? 'on' : 'off'}
            onMouseDown={keepEditorSelection}
            onClick={() => dispatchPreset(PRESET_EQUAL_2)}
            title="Equal width"
            aria-label="Equal width"
          >
            <ColumnPresetIcon variant="equal2" />
          </Toolbar.Button>
          <Toolbar.Button
            type="button"
            className="editor-floating-toolbar-toggle columns-preset-icon-btn"
            data-state={matchesPreset(columnsNode, PRESET_SIDEBAR_RIGHT) ? 'on' : 'off'}
            onMouseDown={keepEditorSelection}
            onClick={() => dispatchPreset(PRESET_SIDEBAR_RIGHT)}
            title="Wider left column"
            aria-label="Wider left column"
          >
            <ColumnPresetIcon variant="sidebarRight2" />
          </Toolbar.Button>
          <Toolbar.Button
            type="button"
            className="editor-floating-toolbar-toggle columns-preset-icon-btn"
            data-state={matchesPreset(columnsNode, PRESET_SIDEBAR_LEFT) ? 'on' : 'off'}
            onMouseDown={keepEditorSelection}
            onClick={() => dispatchPreset(PRESET_SIDEBAR_LEFT)}
            title="Wider right column"
            aria-label="Wider right column"
          >
            <ColumnPresetIcon variant="sidebarLeft2" />
          </Toolbar.Button>
        </>
      )}

      {columnCount === 3 && (
        <>
          <Toolbar.Button
            type="button"
            className="editor-floating-toolbar-toggle columns-preset-icon-btn"
            data-state={matchesPreset(columnsNode, PRESET_EQUAL_3) ? 'on' : 'off'}
            onMouseDown={keepEditorSelection}
            onClick={() => dispatchPreset(PRESET_EQUAL_3)}
            title="Equal width"
            aria-label="Equal width"
          >
            <ColumnPresetIcon variant="equal3" />
          </Toolbar.Button>
          <Toolbar.Button
            type="button"
            className="editor-floating-toolbar-toggle columns-preset-icon-btn"
            data-state={matchesPreset(columnsNode, PRESET_WIDE_CENTER) ? 'on' : 'off'}
            onMouseDown={keepEditorSelection}
            onClick={() => dispatchPreset(PRESET_WIDE_CENTER)}
            title="Wide center column"
            aria-label="Wide center column"
          >
            <ColumnPresetIcon variant="wideCenter3" />
          </Toolbar.Button>
        </>
      )}

      <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" decorative />

      <Toolbar.Button
        type="button"
        className="editor-floating-toolbar-button"
        onMouseDown={keepEditorSelection}
        onClick={handleCopy}
        title="Copy layout"
        aria-label="Copy layout"
      >
        <FiCopy size={16} />
        <span>Copy</span>
      </Toolbar.Button>
      <Toolbar.Button
        type="button"
        className="editor-floating-toolbar-button"
        onMouseDown={keepEditorSelection}
        onClick={handleDelete}
        title="Delete layout"
        aria-label="Delete layout"
      >
        <FiTrash2 size={16} />
        <span>Delete</span>
      </Toolbar.Button>
    </Toolbar.Root>
  );
}
