import { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

import { Table } from "../..";

export const isTableSelected = ({ editor, view, state, from }: { editor: Editor; view: EditorView; state: EditorState; from: number }) => {
    // Check if we're inside a table
    const domAtPos = view.domAtPos(from).node as HTMLElement;
    const nodeDOM = view.nodeDOM(from) as HTMLElement;
    const node = nodeDOM || domAtPos;

    if (!editor.isActive(Table.name) || !node) {
        return false;
    }

    // Ensure node is a DOM element that has the closest method
    if (!(node instanceof Element)) {
        return false;
    }

    const tableElement = node.closest('table');
    if (!tableElement) {
        return false;
    }

    return true;
};

export const getTablePosition = ({ view, state, from }: { view: EditorView; state: EditorState; from: number }): "top" | "bottom" => {
    // Get table element from current position
    const domAtPos = view.domAtPos(from).node as HTMLElement;
    const nodeDOM = view.nodeDOM(from) as HTMLElement;
    const node = nodeDOM || domAtPos;

    if (!node) {
        return "top";
    }

    // Ensure node is a DOM element that has the closest method
    if (!(node instanceof Element)) {
        return "top";
    }

    const tableElement = node.closest('table');
    if (!tableElement) {
        return "top";
    }

    // Get the table's position relative to the viewport
    const tableRect = tableElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const tableCenter = tableRect.top + tableRect.height / 2;
    const viewportCenter = viewportHeight / 2;

    // If table is in the upper half of the viewport, show menu at bottom
    // If table is in the lower half, show menu at top
    return tableCenter < viewportCenter ? "bottom" : "top";
};



export default isTableSelected;
