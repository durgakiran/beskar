import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Editor, Node } from "@tiptap/core";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import Collaboration from "@tiptap/extension-collaboration";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import { DocumentTitle, updateTitle } from "./DocumentTitle";

const disposables: Array<() => void> = [];
afterEach(() => { cleanup(); disposables.splice(0).reverse().forEach(dispose => dispose()); });

function setup(initial = "Project notes", collaborative = false) {
    const doc = new Y.Doc();
    const text = doc.getText("title");
    text.insert(0, initial);
    const awareness = new Awareness(doc);
    const editor = new Editor({
        extensions: [
            Node.create({ name: "doc", topNode: true, content: "block+" }),
            Node.create({ name: "paragraph", group: "block", content: "inline*", parseHTML: () => [{ tag: "p" }], renderHTML: () => ["p", 0] }),
            Node.create({ name: "text", group: "inline" }),
            ...(collaborative ? [Collaboration.configure({ document: doc })] : []),
        ],
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing body" }] }] },
    });
    if (collaborative) {
        editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing body" }] }] });
        yUndoPluginKey.getState(editor.state).undoManager.clear();
    }
    disposables.push(() => { editor.destroy(); awareness.destroy(); doc.destroy(); });
    render(<DocumentTitle text={text} awareness={awareness} editor={editor} />);
    const input = screen.getByRole("textbox", { name: "Document title" }) as HTMLInputElement;
    const select = (from: number, to = from) => {
        act(() => { input.focus(); input.setSelectionRange(from, to); fireEvent.select(input); });
    };
    return { doc, text, awareness, editor, input, select };
}

describe("DocumentTitle", () => {
    it("splits the title into a new first paragraph and preserves the existing body", () => {
        const { input, text, editor, select } = setup();
        select(7, 8);
        fireEvent.keyDown(input, { key: "Enter" });
        expect(text.toString()).toBe("Project");
        expect(editor.state.doc.child(0).textContent).toBe("notes");
        expect(editor.state.doc.child(1).textContent).toBe("Existing body");
        expect(editor.state.selection.from).toBe(1);
    });

    it("creates an empty paragraph at the end of the title, including Shift+Enter", () => {
        const { input, text, editor, select } = setup();
        select(text.length);
        fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
        expect(text.toString()).toBe("Project notes");
        expect(editor.getJSON().content?.[0]).toEqual({ type: "paragraph" });
        expect(editor.getJSON().content).toHaveLength(2);
    });

    it("creates a body paragraph from an empty title", () => {
        const { input, text, editor, select } = setup("");
        select(0);
        fireEvent.keyDown(input, { key: "Enter" });
        expect(text.toString()).toBe("");
        expect(editor.getJSON().content?.[0]).toEqual({ type: "paragraph" });
        expect(editor.getJSON().content).toHaveLength(2);
    });

    it("returns to the title from the start of the body with ArrowUp", () => {
        const { input, editor, text } = setup();
        editor.commands.setTextSelection(1);
        fireEvent.keyDown(editor.view.dom, { key: "ArrowUp" });
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(text.length);
    });

    it("flattens multiline paste and replaces only the selected range", () => {
        const { input, text, select } = setup();
        select(8, 13);
        fireEvent.paste(input, { clipboardData: { getData: () => "new\nideas\u2028today" } });
        expect(text.toString()).toBe("Project new ideas today");
        expect(input.selectionStart).toBe(text.length);
    });

    it("keeps the local caret anchored when a collaborator inserts before it", () => {
        const { text, input, select } = setup();
        select(8);
        act(() => { text.insert(0, "New "); });
        expect(input.value).toBe("New Project notes");
        expect(input.selectionStart).toBe(12);
    });

    it("renders a remote relative cursor and selection, and clears presence on blur", () => {
        const { doc, text, awareness, input, select } = setup();
        const remote = new Y.Doc();
        Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
        const remoteAwareness = new Awareness(remote);
        disposables.push(() => { remoteAwareness.destroy(); remote.destroy(); });
        remoteAwareness.setLocalState({ user: { name: "Alex", color: "#aabbcc" }, titleSelection: {
            anchor: Y.createRelativePositionFromTypeIndex(remote.getText("title"), 2),
            head: Y.createRelativePositionFromTypeIndex(remote.getText("title"), 7),
        } });
        act(() => { applyAwarenessUpdate(awareness, encodeAwarenessUpdate(remoteAwareness, [remote.clientID]), "remote"); });
        expect(screen.getByText("Alex").parentElement?.previousSibling?.textContent).toBe("oject");
        select(3);
        expect(awareness.getLocalState()?.titleSelection).toBeTruthy();
        act(() => { text.insert(0, "New "); });
        expect(screen.getByText("Alex")).toBeTruthy();
        fireEvent.blur(input);
        expect(awareness.getLocalState()?.titleSelection).toBeNull();
    });

    it("hides the local title cursor even when the document client ID changes", () => {
        const { doc, awareness, select } = setup();
        act(() => {
            awareness.setLocalStateField('user', { name: 'Local editor', color: '#aabbcc' });
            doc.clientID = (doc.clientID + 1) % 0x100000000;
        });
        select(2, 5);
        expect(awareness.getLocalState()?.titleSelection).toBeTruthy();
        expect(screen.queryByText('Local editor')).toBeNull();
        expect(document.querySelector('.document-title-caret-label')).toBeNull();
    });

    it("undoes local title edits without undoing remote edits", () => {
        const { input, text } = setup("Hello");
        fireEvent.change(input, { target: { value: "Hello!" } });
        act(() => { text.insert(0, "Remote "); });
        fireEvent.keyDown(input, { key: "z", ctrlKey: true });
        expect(text.toString()).toBe("Remote Hello");
        fireEvent.keyDown(input, { key: "z", ctrlKey: true, shiftKey: true });
        expect(text.toString()).toBe("Remote Hello!");
    });

    it("undoes and redoes an Enter split atomically with the collaborative body", () => {
        const { input, text, editor, select } = setup("Project notes", true);
        select(7);
        fireEvent.keyDown(input, { key: "Enter" });
        expect(text.toString()).toBe("Project");
        expect(editor.getJSON().content).toHaveLength(2);
        act(() => { editor.commands.undo(); });
        expect(text.toString()).toBe("Project notes");
        expect(editor.getJSON().content).toHaveLength(1);
        act(() => { editor.commands.redo(); });
        expect(text.toString()).toBe("Project");
        expect(editor.getJSON().content).toHaveLength(2);
    });

    it("replaces emoji without splitting their UTF-16 surrogate pairs", () => {
        const { text } = setup("Hi 😀");
        updateTitle(text, "Hi 😃", "local");
        expect(text.toString()).toBe("Hi 😃");
    });

    it("allows Enter to confirm an IME composition and preserves remote input during composition", () => {
        const { input, text, editor, select } = setup("Hello");
        select(5);
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: "Hello世" } });
        act(() => { text.insert(0, "Remote "); });
        fireEvent.keyDown(input, { key: "Enter", isComposing: true });
        expect(editor.getJSON().content).toHaveLength(1);
        fireEvent.compositionEnd(input, { data: "世" });
        expect(text.toString()).toBe("Remote Hello世");
    });

    it("converges concurrent character edits without duplicating unchanged title text", () => {
        const first = new Y.Doc();
        const second = new Y.Doc();
        first.getText("title").insert(0, "Hello world");
        Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
        updateTitle(first.getText("title"), "Hello brave world", "local");
        updateTitle(second.getText("title"), "Hello world!", "remote");
        Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
        Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
        expect(first.getText("title").toString()).toBe("Hello brave world!");
        expect(second.getText("title").toString()).toBe("Hello brave world!");
        first.destroy(); second.destroy();
    });
});
