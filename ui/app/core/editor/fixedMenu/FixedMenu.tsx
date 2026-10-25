import { DropdownMenu, Tooltip } from '@radix-ui/themes';
import { useContext, useEffect, useReducer, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import {
    Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Code, Link,
    List, ListOrdered, ListTodo, IndentIncrease, IndentDecrease, AlignLeft,
    AlignCenter, AlignRight, AlignJustify, ChevronDown, RemoveFormatting,
    MessageSquare, MessageSquarePlus, Table2,
} from 'lucide-react';
import { openLinkEditor } from '@durgakiran/editor';
import { EditorContext } from '@editor/context/editorContext';
import { InsertMenu } from './InsertMenu';
import { ColorMenu } from './ColorMenu';
import './fixedMenu.css';

function Tool({ label, children, active, disabled, onClick }: {
    label: string; children: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
    return <Tooltip content={label}><button type="button" className="document-tool"
        aria-label={label} aria-pressed={active} disabled={disabled}
        onMouseDown={event => event.preventDefault()} onClick={onClick}>{children}</button></Tooltip>;
}

const tableActions = [
    ['Add row above', 'addRowBefore'], ['Add row below', 'addRowAfter'],
    ['Add column before', 'addColumnBefore'], ['Add column after', 'addColumnAfter'],
    ['Toggle header row', 'toggleHeaderRow'], ['Toggle header column', 'toggleHeaderColumn'],
    ['Merge cells', 'mergeCells'], ['Split cell', 'splitCell'],
    ['Delete row', 'deleteRow'], ['Delete column', 'deleteColumn'], ['Delete table', 'deleteTable'],
] as const;

export default function FixedMenu({ isEditorReady, isSidePanelOpen, setIsSidePanelOpen, canComment }: {
    isEditorReady: boolean; isSidePanelOpen: boolean; setIsSidePanelOpen: (open: boolean) => void; canComment: boolean;
}) {
    const editor = useContext(EditorContext);
    const [, refresh] = useReducer(value => value + 1, 0);
    useEffect(() => {
        if (!editor) return;
        const sync = () => refresh();
        editor.on('transaction', sync);
        editor.on('selectionUpdate', sync);
        return () => { editor.off('transaction', sync); editor.off('selectionUpdate', sync); };
    }, [editor]);

    if (!editor) return <div className="document-toolbar-loading" role="status">Loading editing tools…</div>;
    return <EditorTools editor={editor} disabled={!isEditorReady || !editor.isEditable}
        canComment={canComment} isSidePanelOpen={isSidePanelOpen} setIsSidePanelOpen={setIsSidePanelOpen} />;
}

function EditorTools({ editor, disabled, canComment, isSidePanelOpen, setIsSidePanelOpen }: {
    editor: Editor; disabled: boolean; canComment: boolean; isSidePanelOpen: boolean; setIsSidePanelOpen: (open: boolean) => void;
}) {
    // Test commands without dispatching. Some hosts disable optional extensions.
    const can = (command: string, ...args: unknown[]) => !disabled && Boolean(editor.commands[command]) && Boolean(editor.can()[command]?.(...args));
    const run = (command: string, ...args: unknown[]) => editor.chain().focus()[command](...args).run();
    const clearFormatting = () => {
        const chain = editor.chain().focus();
        // Keep semantic marks such as links and comment anchors intact.
        for (const mark of ['bold', 'italic', 'underline', 'strike', 'code', 'textStyle', 'highlight']) {
            if (editor.schema.marks[mark]) chain.unsetMark(mark);
        }
        chain.run();
    };
    const heading = editor.getAttributes('heading').level;
    const blockLabel = editor.isActive('heading') ? `Heading ${heading}` : editor.isActive('codeBlock') ? 'Code block' : 'Normal text';
    const alignment = ['left', 'center', 'right', 'justify'].find(value => editor.isActive({ textAlign: value })) || 'left';
    const AlignmentIcon = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify }[alignment];
    const item = (label: string, command: string, active?: boolean, ...args: unknown[]) => <DropdownMenu.Item
        key={label} disabled={!can(command, ...args)} onSelect={() => run(command, ...args)}>
        {label}{active && <span aria-label="Selected">✓</span>}
    </DropdownMenu.Item>;
    const listItem = editor.isActive('taskList') ? 'taskItem' : 'listItem';
    const selection = editor.state.selection;
    const commentDisabled = disabled || selection.empty || !editor.state.doc.textBetween(selection.from, selection.to, ' ').trim();

    return <div className="document-toolbar" role="group" aria-label="Document editing tools">
        <div className="document-tool-group" role="group" aria-label="History">
            <Tool label="Undo (Ctrl/⌘ Z)" disabled={!can('undo')} onClick={() => run('undo')}><Undo2 size={17} /></Tool>
            <Tool label="Redo (Ctrl/⌘ Shift Z)" disabled={!can('redo')} onClick={() => run('redo')}><Redo2 size={17} /></Tool>
        </div>
        <div className="document-tool-group" role="group" aria-label="Text style">
            <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="document-tool document-tool--style" disabled={disabled} aria-label="Text style">
                {blockLabel}<ChevronDown size={14} />
            </button></DropdownMenu.Trigger><DropdownMenu.Content onCloseAutoFocus={event => event.preventDefault()}>
                {item('Normal text', 'setParagraph', editor.isActive('paragraph'))}
                {[1, 2, 3, 4, 5, 6].map(level => item(`Heading ${level}`, 'setHeading', editor.isActive('heading', { level }), { level }))}
                <DropdownMenu.Separator />
                {item('Quote', 'toggleBlockquote', editor.isActive('blockquote'))}
                {item('Code block', 'toggleCodeBlock', editor.isActive('codeBlock'))}
            </DropdownMenu.Content></DropdownMenu.Root>
        </div>
        <div className="document-tool-group" role="group" aria-label="Text formatting">
            {[
                ['Bold (Ctrl/⌘ B)', 'toggleBold', 'bold', Bold], ['Italic (Ctrl/⌘ I)', 'toggleItalic', 'italic', Italic],
                ['Underline (Ctrl/⌘ U)', 'toggleUnderline', 'underline', Underline], ['Strikethrough', 'toggleStrike', 'strike', Strikethrough],
                ['Inline code', 'toggleCode', 'code', Code],
            ].map(([label, command, mark, Icon]: [string, string, string, typeof Bold]) => <Tool key={mark} label={label}
                active={editor.isActive(mark)} disabled={!can(command)} onClick={() => run(command)}><Icon size={17} /></Tool>)}
            <ColorMenu editor={editor} disabled={!can('setColor', '#2563eb')} />
            <ColorMenu editor={editor} highlight disabled={!can('setHighlight', { color: '#fef9c3' })} />
            <Tool label="Clear text formatting" disabled={disabled} onClick={clearFormatting}><RemoveFormatting size={17} /></Tool>
        </div>
        <div className="document-tool-group" role="group" aria-label="Lists and alignment">
            {[
                ['Bullet list', 'toggleBulletList', 'bulletList', List], ['Numbered list', 'toggleOrderedList', 'orderedList', ListOrdered],
                ['Task list', 'toggleTaskList', 'taskList', ListTodo],
            ].map(([label, command, node, Icon]: [string, string, string, typeof List]) => <Tool key={node} label={label}
                active={editor.isActive(node)} disabled={!can(command)} onClick={() => run(command)}><Icon size={17} /></Tool>)}
            <Tool label="Decrease list indent" disabled={!can('liftListItem', listItem)} onClick={() => run('liftListItem', listItem)}><IndentDecrease size={17} /></Tool>
            <Tool label="Increase list indent" disabled={!can('sinkListItem', listItem)} onClick={() => run('sinkListItem', listItem)}><IndentIncrease size={17} /></Tool>
            <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="document-tool" aria-label="Text alignment" disabled={disabled}>
                <AlignmentIcon size={17} /><ChevronDown size={12} />
            </button></DropdownMenu.Trigger><DropdownMenu.Content onCloseAutoFocus={event => event.preventDefault()}>
                {['left', 'center', 'right', 'justify'].map(value => item(value === 'justify' ? 'Justify' : `Align ${value}`, 'setTextAlign', alignment === value, value))}
            </DropdownMenu.Content></DropdownMenu.Root>
        </div>
        <div className="document-tool-group" role="group" aria-label="Insert content">
            <Tool label="Add or edit link (Ctrl/⌘ K)" active={editor.isActive('link')} disabled={disabled || !editor.schema.marks.link}
                onClick={() => openLinkEditor(editor)}><Link size={17} /></Tool>
            <InsertMenu editor={editor} disabled={disabled} />
            {editor.isActive('table') && <DropdownMenu.Root><DropdownMenu.Trigger><button type="button" className="document-tool document-tool--table" disabled={disabled}>
                <Table2 size={16} /> Table <ChevronDown size={12} />
            </button></DropdownMenu.Trigger><DropdownMenu.Content onCloseAutoFocus={event => event.preventDefault()}>
                {tableActions.map(([label, command]) => item(label, command))}
            </DropdownMenu.Content></DropdownMenu.Root>}
        </div>
        {canComment && <div className="document-tool-group document-tool-group--comments" role="group" aria-label="Comments">
            <Tool label={commentDisabled ? 'Select text to add a comment' : 'Add comment'} disabled={commentDisabled}
                onClick={() => editor.view.dom.dispatchEvent(new Event('beskar:add-comment'))}><MessageSquarePlus size={17} /></Tool>
            <button type="button" className="document-tool document-tool--comments" disabled={disabled} aria-pressed={isSidePanelOpen}
                onClick={() => setIsSidePanelOpen(!isSidePanelOpen)}><MessageSquare size={16} /> Comments</button>
        </div>}
    </div>;
}
