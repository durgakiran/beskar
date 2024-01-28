"use client";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import styled from "styled-components";
import Typography from "@tiptap/extension-typography";
import TextAlign from "@tiptap/extension-text-align";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Document from "@tiptap/extension-document";
import Heading from "@tiptap/extension-heading";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-placeholder";
import Color from "@tiptap/extension-placeholder";
// import Collaboration from '@tiptap/extension-collaboration'
// import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlock from "@tiptap/extension-code-block";
// import { WebrtcProvider } from 'y-webrtc'
// import * as Y from 'yjs'
// import { EXAMPLE_JSON } from "@editor";
import { Button, ButtonGroup, IconButton, Tooltip } from "@primer/react";
import { useDebounce } from "app/core/hooks/debounce";
import { useEffect, useState } from "react";
import { GRAPHQL_UPDATE_DOC_DATA } from "@queries/space";
import { client } from "@http";
import { useMutation } from "@apollo/client";
import { BubbleMenu } from "./bubbleMenu/bubbleMenu";
import { BoldIcon, StrikethroughIcon, ItalicIcon } from "@primer/octicons-react";
import { UnderlineIcon } from "lucide-react";
import "./styles.css";
import { ModifiedUnderlineIcon } from "./Button/modifiedIconButton";
import FixedMenu from "./fixedMenu/FixedMenu";
// import { useDidMountEffect } from "app/core/hooks/didMountEffect";

// const ydoc = new Y.Doc()
// const provider = new WebrtcProvider('tiptap-collaboration-cursor-extension', ydoc)

const extensions = [
    StarterKit.configure({
        history: false,
    }),
    Typography,
    TextAlign.configure({
        types: ["heading", "paragraph"],
        alignments: ["left", "right", "center", "justify"],
    }),
    Paragraph,
    Text,
    Document,
    Heading,
    Placeholder.configure({
        placeholder: "Write somthing ....",
    }),
    TextStyle,
    Color,
    // Collaboration.configure({
    //     document: ydoc,
    //   }),
    //   CollaborationCursor.configure({
    //     provider,
    //     user: {
    //       name: 'Cyndi Lauper',
    //       color: '#f783ac',
    //     },
    // }),
    TaskList,
    TaskItem.configure({
        nested: true,
    }),
    CodeBlock,
    Underline,
];

interface TipTapProps {
    setEditorContext: (editorContext: Editor) => void;
    content: Object;
    pageId: string;
    id: number;
    editable?: boolean;
}

export function TipTap({ setEditorContext, content, pageId, id, editable = true }: TipTapProps) {
    const [editedData, setEditedData] = useState(null);
    const debouncedValue = useDebounce(editedData, 10000);
    const [updated, setUpdated] = useState(false);
    const [mutateFunction, { data, loading, error }] = useMutation(GRAPHQL_UPDATE_DOC_DATA, { client: client });

    const editor = useEditor({
        extensions: extensions,
        content: content,
        editable: editable,
        onUpdate: ({ editor }) => {
            setUpdated(true);
            setEditedData(editor.getJSON());
        },
    });

    useEffect(() => {
        if (content && editor) {
            editor.commands.setContent(content);
        }
    }, [content, editor]);

    useEffect(() => {
        setEditorContext(editor);
    }, [editor, setEditorContext]);

    useEffect(() => {
        if (updated) {
            mutateFunction({ variables: { id: id, pageId: pageId, data: debouncedValue, title: "Fifth Page" } })
                .then((data) => console.log(data))
                .catch((error) => console.log(error));
        }
    }, [debouncedValue]);

    return (
        <>
            {editor && (
                <BubbleMenu className="bubble-menu" editor={editor} tippyOptions={{ duration: 100 }}>
                    <Tooltip aria-label="Bold">
                        <IconButton aria-label="bold" icon={BoldIcon} size="small" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive("bold") ? "is-active" : ""} />
                    </Tooltip>
                    <IconButton
                        aria-label="strikethrough"
                        icon={StrikethroughIcon}
                        size="small"
                        onClick={() => editor.chain().focus().toggleStrike().run()}
                        className={editor.isActive("bold") ? "is-active" : ""}
                    />
                    <IconButton
                        aria-label="italic"
                        icon={ItalicIcon}
                        size="small"
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        className={editor.isActive("italic") ? "is-active" : ""}
                    />
                    <IconButton
                        aria-label="underline"
                        icon={ModifiedUnderlineIcon}
                        size="small"
                        onClick={() => editor.chain().focus().toggleUnderline().run()}
                        className={editor.isActive("underline") ? "is-active" : ""}
                    />
                </BubbleMenu>
            )}
            <EditorContent className="editor" editor={editor} />
        </>
    );
}
