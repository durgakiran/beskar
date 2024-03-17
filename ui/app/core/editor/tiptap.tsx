"use client";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
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
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlock from "@tiptap/extension-code-block";
import { IconButton, Tooltip } from "@primer/react";
import { useDebounce } from "app/core/hooks/debounce";
import { useEffect, useState } from "react";
import { GRAPHQL_UPDATE_DOC_DATA, GRAPHQL_UPDATE_DOC_TITLE } from "@queries/space";
import { client } from "@http";
import { useMutation } from "@apollo/client";
import { BubbleMenu } from "./bubbleMenu/bubbleMenu";
import { BoldIcon, StrikethroughIcon, ItalicIcon } from "@primer/octicons-react";
import "./styles.css";
import { ModifiedUnderlineIcon } from "./Button/modifiedIconButton";
import { uploadImageData } from "../http/uploadImageData";
import { customImage, reactImage } from "./image/image";

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
    reactImage
];

interface TipTapProps {
    setEditorContext: (editorContext: Editor) => void;
    content: Object;
    pageId: string;
    id: number;
    editable?: boolean;
    title: string;
}

export function TipTap({ setEditorContext, content, pageId, id, editable = true, title }: TipTapProps) {
    const [editedData, setEditedData] = useState(null);
    const debouncedValue = useDebounce(editedData, 10000);
    const debouncedTitle = useDebounce(title, 10000);
    const [updated, setUpdated] = useState(false);
    const [mutateFunction, { data, loading, error }] = useMutation(GRAPHQL_UPDATE_DOC_DATA, { client: client });
    const [mutateTitleFn, {  data: titleData, loading: titleLoading, error: TitleError }] = useMutation(GRAPHQL_UPDATE_DOC_TITLE, { client: client });

    const editor = useEditor({
        extensions: extensions,
        content: content,
        editable: editable,
        onUpdate: ({ editor }) => {
            setUpdated(true);
            setEditedData(editor.getJSON());
        },
        editorProps: {
            handlePaste(view, event, slice) {
                // we will handle paste here.
                let cbPayload = [...event.clipboardData.items];
                cbPayload = cbPayload.filter((i) => /image/.test(i.type) && i.type != "");
                if(!cbPayload.length || cbPayload.length === 0) return false; // not handled use default behaviour
                uploadImageData(cbPayload[0].getAsFile()).then((name) => {
                    const { schema } = view.state;
                    const node = schema.nodes.image.create({ src: `${process.env.NEXT_PUBLIC_IMAGE_SERVER_URL}/media/${name}` }); // creates the image element
                    const transaction = view.state.tr.replaceSelectionWith(node); // places it in the correct position
                    view.dispatch(transaction);
                }).catch((err) => {
                    console.error(err);
                });
                return true; 
            },
        }
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
            mutateFunction({ variables: { id: id, pageId: pageId, data: debouncedValue, title: debouncedTitle } })
                .then((data) => console.log(data))
                .catch((error) => console.log(error));
        }
    }, [debouncedValue]);


    useEffect(() => {
        mutateTitleFn({ variables: { id: id, pageId: pageId, title: debouncedTitle } })
            .then((data) => console.log(data))
            .catch((error) => console.log(error));
    }, [debouncedTitle]);

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
