"use client";
import { Editor, EditorContent, JSONContent, useEditor } from "@tiptap/react";
import Typography from "@tiptap/extension-typography";
import TextAlign from "@tiptap/extension-text-align";
import Paragraph from "@tiptap/extension-paragraph";
import Bold from "@tiptap/extension-bold";
import BulletList from "@tiptap/extension-bullet-list";
import Code from "@tiptap/extension-code";
import Dropcursor from "@tiptap/extension-dropcursor";
import Gapcursor from "@tiptap/extension-gapcursor";
import Hardbreak from "@tiptap/extension-hard-break";
import Horizontalrule from "@tiptap/extension-horizontal-rule";
import Italic from "@tiptap/extension-italic";
import ListItem from "@tiptap/extension-list-item";
import OrderedList from "@tiptap/extension-ordered-list";
import Strike from "@tiptap/extension-strike";
import Text from "@tiptap/extension-text";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlock from "@tiptap/extension-code-block";
import blockQuote from "@tiptap/extension-blockquote";
import { Button, Tooltip } from "flowbite-react";
import { GrStrikeThrough, GrItalic, GrBold } from "react-icons/gr";
import { useDebounce } from "app/core/hooks/debounce";
import {  useEffect, useMemo, useRef, useState } from "react";
import { BubbleMenu } from "./bubbleMenu/bubbleMenu";
import "./styles.css";
import { ModifiedUnderlineIcon } from "./Button/modifiedIconButton";
import { uploadImageData } from "../http/uploadImageData";
import { customImage, reactImage } from "./image/image";
import { SlashCommand } from "./extensions/slashCommand/command";
import { CustomInput } from "./note/Note";
import { TableColumnMenu, TableRowMenu, TableMenu } from "./Table/menus";
import { Table, TableCell, TableHeader, TableRow } from "./Table";
import { CustomAttributes } from "@editor/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { MermaidNode } from "./mermaid";

const extensions = [
    CustomAttributes,
    Bold,
    BulletList,
    Code,
    Dropcursor,
    Gapcursor,
    Hardbreak,
    Horizontalrule,
    Italic,
    ListItem,
    OrderedList,
    Strike,
    Typography,
    TextAlign.configure({
        types: ["heading", "paragraph"],
        alignments: ["left", "right", "center", "justify"],
    }),
    Paragraph,
    blockQuote,
    Text,
    Document,
    Heading,
    Placeholder.configure({
        placeholder: "Write something ....",
    }),
    TextStyle,
    Color,
    TaskList,
    TaskItem.configure({
        nested: true,
        onReadOnlyChecked: (node, checked) => {
            return false;
        },
    }),
    CodeBlock,
    Underline,
    customImage,
    reactImage,
    SlashCommand,
    CustomInput,
    Table,
    TableCell,
    TableHeader,
    TableRow,
    MermaidNode,
];

interface TipTapProps {
    setEditorContext: (editorContext: Editor) => void;
    user: UserInfo;
    content: Object;
    pageId: string;
    id: number;
    editable?: boolean;
    title: string;
    updateContent: (content: any, title: string) => void;
    provider?: HocuspocusProvider
}

const MAX_DEFAULT_WIDTH = 760;

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
}

export function TipTap({ setEditorContext, user, content, pageId, id, editable = true, title, updateContent, provider }: TipTapProps) {
    const [editedData, setEditedData] = useState(null);
    const menuContainerRef = useRef(null);
    const debouncedValue = useDebounce(editedData, 10000);
    const debouncedTitle = useDebounce(title, 10000);
    const [updated, setUpdated] = useState(false);
    const countRenderRef = useRef(0);
    countRenderRef.current += 1;

    const editedDataFn = (data: JSONContent) => {
        setEditedData(data);
    };

    const collaborationExtensions = () => {
        return [
            Collaboration.configure({
                document: provider?.document,
                field: "default"
            }),
            CollaborationCursor.configure({
                provider: provider,
                user: { id: user.id, name: user.name, color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}` },
            }),
        ];
    }

    const manageContent = useMemo(() => {
        if (editable) {
            return {
                onCreate: ({ editor: currentEditor }: { editor: Editor }) => {
                    if (provider) {
                        // provider.connect();
                    }
                },
            };
        } else {
            return { content: content };
        }
    }, []);

    const editor = useEditor({
        immediatelyRender: true,
        shouldRerenderOnTransaction: false,
        extensions: extensions.concat(editable ? collaborationExtensions() : []),
        ...manageContent,
        editable: editable,
        onUpdate: ({ editor }) => {
            setUpdated(true);
            editedDataFn(editor.getJSON());
        },
        onDestroy: () => {
            // TODO: Update data
        },
        editorProps: {
            handlePaste(view, event, slice) {
                // Handle image paste
                let cbPayload = [...event.clipboardData.items];
                cbPayload = cbPayload.filter((i) => /image/.test(i.type) && i.type != "");
                if (cbPayload.length > 0) {
                    uploadImageData(cbPayload[0].getAsFile())
                        .then(([name, width, height]) => {
                            const { schema } = view.state;
                            if (width > MAX_DEFAULT_WIDTH) {
                                const ratio = MAX_DEFAULT_WIDTH / width;
                                width = 760;
                                height = Math.round(ratio * height);
                            }
                            const node = schema.nodes.image.create({ src: `${process.env.NEXT_PUBLIC_IMAGE_SERVER_URL}/media/image/${name}`, width, height }); // creates the image element
                            const transaction = view.state.tr.replaceSelectionWith(node); // places it in the correct position
                            view.dispatch(transaction);
                        })
                        .catch((err) => {
                            console.error(err);
                        });
                    return true;
                }

                // Handle Mermaid node paste
                const clipboardText = event.clipboardData.getData('text/plain');
                if (clipboardText) {
                    try {
                        // Check if the clipboard contains a Mermaid node
                        const parsed = JSON.parse(clipboardText);
                        if (parsed.type === 'mermaid' && parsed.attrs) {
                            const { schema } = view.state;
                            const mermaidNode = schema.nodes.mermaid.create({
                                diagram: parsed.attrs.diagram || "",
                                title: parsed.attrs.title || "",
                                layout: parsed.attrs.layout || "horizontal",
                                zoom: parsed.attrs.zoom || 1
                            });
                            const transaction = view.state.tr.replaceSelectionWith(mermaidNode);
                            view.dispatch(transaction);
                            return true;
                        }
                    } catch (e) {
                        // Not JSON, continue with default paste behavior
                    }
                }

                return false; // Use default paste behavior
            },
        },
    });

    useEffect(() => {
        if (updated && editable) {
            updateContent(debouncedValue, debouncedTitle);
        }
    }, [debouncedValue, debouncedTitle]);

    useEffect(() => {
        setEditorContext(editor);
    }, [editor, setEditorContext]);

    return (
        <div ref={menuContainerRef}>
            <div>Rendered: {countRenderRef.current}</div>
            {editor && (
                <BubbleMenu className="bubble-menu" editor={editor} tippyOptions={{ duration: 100 }}>
                    <Tooltip content="Bold">
                        <Button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "is-active" : ""}>
                            <GrBold />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Strike">
                        <Button onClick={() => editor.chain().focus().toggleStrike().run()} className={editor.isActive("strike") ? "is-active" : ""}>
                            <GrStrikeThrough />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Italic">
                        <Button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive("italic") ? "is-active" : ""}>
                            <GrItalic />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Underline">
                        <Button onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive("underline") ? "is-active" : ""}>
                            <ModifiedUnderlineIcon />
                        </Button>
                    </Tooltip>
                </BubbleMenu>
            )}
            <EditorContent className="editor" editor={editor} />
            {editor && (
                <>
                    <TableMenu editor={editor} appendTo={menuContainerRef} />
                    <TableRowMenu editor={editor} appendTo={menuContainerRef} />
                    <TableColumnMenu editor={editor} appendTo={menuContainerRef} />
                </>
            )}
        </div>
    );
}
