import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Awareness } from "y-protocols/awareness";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

type TitleSelection = { anchor: Y.RelativePosition; head: Y.RelativePosition };
type Peer = { clientId: number; anchor: number; head: number; name: string; color: string };
const singleLine = (value: string) => value.replace(/[\r\n\u2028\u2029]/g, " ");

function titleDiff(before: string, value: string) {
    const next = singleLine(value);
    let start = 0;
    while (start < before.length && start < next.length && before[start] === next[start]) start++;
    // Y.Text indexes UTF-16, but a diff must never split a surrogate pair.
    if (start > 0 && /[\uDC00-\uDFFF]/.test(before[start] || next[start] || "")) start--;
    let end = before.length;
    let nextEnd = next.length;
    while (end > start && nextEnd > start && before[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
    if (/[\uDC00-\uDFFF]/.test(before[end] || next[nextEnd] || "")) { end++; nextEnd++; }
    return { start, end, inserted: next.slice(start, nextEnd) };
}

/** Preserve unchanged characters so concurrent edits and relative cursors survive. */
export function updateTitle(text: Y.Text, value: string, origin: unknown) {
    const { start, end, inserted } = titleDiff(text.toString(), value);
    text.doc!.transact(() => {
        if (end > start) text.delete(start, end - start);
        if (inserted) text.insert(start, inserted);
    }, origin);
}

export function insertTitleParagraph(editor: Editor, trailingText: string) {
    return editor.chain().insertContentAt(0, {
        type: "paragraph",
        content: trailingText ? [{ type: "text", text: trailingText }] : [],
    }).setTextSelection(1).focus().run();
}

export function DocumentTitle({ text, awareness, editor, disabled = false, label = 'Document title', className = '', cursorField = 'cursor', onBlur }: {
    text: Y.Text; awareness: Awareness; editor?: Editor; disabled?: boolean;
    label?: string; className?: string; cursorField?: string; onBlur?: () => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const origin = useRef(Symbol("document-title"));
    const selectionRef = useRef<TitleSelection | null>(null);
    const undoRef = useRef<Y.UndoManager | null>(null);
    const composing = useRef(false);
    const compositionBase = useRef<{ value: string; positions: Y.RelativePosition[] } | null>(null);
    const [value, setValue] = useState(() => singleLine(text.toString()));
    const [peers, setPeers] = useState<Peer[]>([]);
    const [scrollLeft, setScrollLeft] = useState(0);

    const resolve = (position: Y.RelativePosition) => {
        try {
            const absolute = Y.createAbsolutePositionFromRelativePosition(position, text.doc!);
            return absolute?.type === text ? absolute.index : null;
        } catch { return null; }
    };

    const publishSelection = () => {
        const input = inputRef.current;
        if (!input || document.activeElement !== input) return;
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;
        const backward = input.selectionDirection === "backward";
        const selection = {
            anchor: Y.createRelativePositionFromTypeIndex(text, backward ? end : start),
            head: Y.createRelativePositionFromTypeIndex(text, backward ? start : end),
        };
        selectionRef.current = selection;
        const current = awareness.getLocalState();
        const previous = current?.titleSelection as TitleSelection | undefined;
        if (!previous || current?.[cursorField] != null ||
            !Y.compareRelativePositions(previous.anchor, selection.anchor) ||
            !Y.compareRelativePositions(previous.head, selection.head)) {
            // Publish the active surface and selection in a single presence update.
            awareness.setLocalState({ ...current, titleSelection: selection, [cursorField]: null });
        }
        setScrollLeft(input.scrollLeft);
    };

    useEffect(() => {
        const bodyUndo = editor && yUndoPluginKey.getState(editor.state)?.undoManager as Y.UndoManager | undefined;
        const sharedUndo = bodyUndo?.doc === text.doc ? bodyUndo : undefined;
        const undo = sharedUndo ?? new Y.UndoManager(text, { trackedOrigins: new Set([origin.current]) });
        if (sharedUndo) { undo.addToScope(text); undo.trackedOrigins.add(origin.current); }
        undoRef.current = undo;
        const syncPeers = () => {
            const next: Peer[] = [];
            awareness.getStates().forEach((state, clientId) => {
                if (clientId === awareness.clientID || !state.titleSelection || !state.user) return;
                const anchor = resolve(state.titleSelection.anchor);
                const head = resolve(state.titleSelection.head);
                if (anchor === null || head === null) return;
                next.push({ clientId, anchor, head, name: state.user.name || "Collaborator",
                    color: /^#[\da-f]{6}$/i.test(state.user.color) ? state.user.color : "#6366f1" });
            });
            setPeers(next);
        };
        const syncText = () => {
            // Let the browser finish its IME composition before replacing its value.
            if (!composing.current) setValue(singleLine(text.toString()));
            syncPeers();
        };
        syncText();
        text.observe(syncText);
        awareness.on("change", syncPeers);
        return () => {
            text.unobserve(syncText);
            awareness.off("change", syncPeers);
            awareness.setLocalStateField("titleSelection", null);
            if (sharedUndo) undo.trackedOrigins.delete(origin.current);
            else undo.destroy();
        };
    }, [text, awareness, editor]);

    useEffect(() => {
        if (!editor) return;
        const returnToTitle = (event: KeyboardEvent) => {
            const { selection } = editor.state;
            if (event.isComposing || event.shiftKey || !selection.empty || selection.from !== 1) return;
            if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                event.preventDefault();
                inputRef.current?.focus();
                inputRef.current?.setSelectionRange(text.length, text.length);
                publishSelection();
            }
        };
        editor.view.dom.addEventListener("keydown", returnToTitle, true);
        return () => editor.view.dom.removeEventListener("keydown", returnToTitle, true);
    }, [editor, text, awareness]);

    useLayoutEffect(() => {
        const input = inputRef.current;
        const selection = selectionRef.current;
        if (!input || document.activeElement !== input || !selection || composing.current) return;
        const anchor = resolve(selection.anchor);
        const head = resolve(selection.head);
        if (anchor !== null && head !== null) {
            input.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? "backward" : "forward");
        }
        setScrollLeft(input.scrollLeft);
    }, [value]);

    const commit = (next: string) => {
        updateTitle(text, next, origin.current);
        setValue(singleLine(text.toString()));
        publishSelection();
    };

    const enterBody = () => {
        const input = inputRef.current;
        if (!input || !editor || disabled) return;
        const start = input.selectionStart ?? value.length;
        const end = input.selectionEnd ?? start;
        undoRef.current?.stopCapturing();
        // A title split and its new body block must undo together.
        text.doc!.transact(() => {
            if (insertTitleParagraph(editor, value.slice(end))) {
                updateTitle(text, value.slice(0, start), origin.current);
            }
        }, origin.current);
        undoRef.current?.stopCapturing();
    };

    return <div className={`document-title ${className}`}>
        <input
            ref={inputRef}
            className="document-title-input"
            type="text"
            aria-label={label}
            aria-multiline="false"
            placeholder="Untitled"
            autoComplete="off"
            disabled={disabled}
            value={value}
            onChange={event => {
                if (composing.current) setValue(event.currentTarget.value);
                else commit(event.currentTarget.value);
            }}
            onCompositionStart={() => {
                composing.current = true;
                compositionBase.current = { value, positions: Array.from({ length: text.length + 1 }, (_, index) =>
                    Y.createRelativePositionFromTypeIndex(text, index)) };
            }}
            onCompositionEnd={event => {
                composing.current = false;
                const base = compositionBase.current;
                compositionBase.current = null;
                if (!base) { commit(event.currentTarget.value); return; }
                const diff = titleDiff(base.value, event.currentTarget.value);
                const start = resolve(base.positions[diff.start]);
                const end = resolve(base.positions[diff.end]);
                if (start !== null && end !== null) {
                    text.doc!.transact(() => {
                        if (end > start) text.delete(start, end - start);
                        if (diff.inserted) text.insert(start, diff.inserted);
                    }, origin.current);
                    event.currentTarget.value = singleLine(text.toString());
                    event.currentTarget.setSelectionRange(start + diff.inserted.length, start + diff.inserted.length);
                    setValue(event.currentTarget.value);
                    publishSelection();
                }
            }}
            onFocus={publishSelection}
            onSelect={publishSelection}
            onKeyUp={publishSelection}
            onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}
            onBlur={() => {
                selectionRef.current = null;
                awareness.setLocalStateField("titleSelection", null);
                undoRef.current?.stopCapturing();
                onBlur?.();
            }}
            onBeforeInput={event => {
                const inputType = (event.nativeEvent as InputEvent).inputType;
                if (!composing.current && (inputType === "insertParagraph" || inputType === "insertLineBreak")) {
                    event.preventDefault();
                    enterBody();
                }
            }}
            onPaste={event => {
                event.preventDefault();
                const input = event.currentTarget;
                const start = input.selectionStart ?? value.length;
                const end = input.selectionEnd ?? start;
                const pasted = singleLine(event.clipboardData.getData("text/plain"));
                input.value = value.slice(0, start) + pasted + value.slice(end);
                input.setSelectionRange(start + pasted.length, start + pasted.length);
                commit(input.value);
            }}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
                if (event.key === "Enter") { event.preventDefault(); if (editor) enterBody(); else if (onBlur) event.currentTarget.blur(); }
                else if (event.key === "ArrowDown" && !event.shiftKey && editor) {
                    event.preventDefault(); editor.commands.focus("start");
                } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                    event.preventDefault();
                    if (event.shiftKey) undoRef.current?.redo();
                    else undoRef.current?.undo();
                }
            }}
        />
        <div className="document-title-presence" aria-hidden="true">
            {peers.map(peer => {
                const from = Math.min(peer.anchor, peer.head);
                const to = Math.max(peer.anchor, peer.head);
                const caret = <span className="document-title-caret" style={{ borderColor: peer.color }}>
                    <span className="document-title-caret-label" style={{ backgroundColor: peer.color }}>{peer.name}</span>
                </span>;
                return <div key={peer.clientId} className="document-title-peer" style={{ transform: `translateX(${-scrollLeft}px)` }}>
                    {value.slice(0, from)}{peer.head === from && caret}
                    <span style={{ backgroundColor: `${peer.color}40` }}>{value.slice(from, to)}</span>
                    {peer.head !== from && caret}
                </div>;
            })}
        </div>
    </div>;
}
