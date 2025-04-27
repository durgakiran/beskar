import { FlaotingOptions } from "@editor/utils/FloatingOptions";
import { Node } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes } from "@tiptap/react";
import { useId, useRef, useState } from "react";
import { autoUpdate, flip, offset, shift, useClick, useFloating, useInteractions } from "@floating-ui/react";
import { BiSolidNotepad } from "react-icons/bi";
import { MdInfo } from "react-icons/md";
import { MdOutlineWarning } from "react-icons/md";
import { MdCancel } from "react-icons/md";
import data from "@emoji-mart/data";
import { init, SearchIndex } from "emoji-mart";

init({ data });

const NoteBlock = (props) => {
    const id = useId();
    const ref = useRef();
    const [isOpen, setIsOpen] = useState(false);
    const { refs, floatingStyles, context } = useFloating({ whileElementsMounted: autoUpdate, open: isOpen, onOpenChange: setIsOpen, middleware: [offset(10), flip(), shift()] });
    const click = useClick(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([click]);
    const handleColorSelection = (color: string) => {
        props.updateAttributes({
            color: color,
        });
    };
    const [customEmoji, setCustomEmoji] = useState();

    let emoji = <BiSolidNotepad />;
    const iconProps = {
        size: 24,
    };

    switch (props.node.attrs.emoji) {
        case ":dfnote:":
            emoji = <BiSolidNotepad {...iconProps} color="#6e5dc6" />;
            break;
        case ":dfinfo:":
            emoji = <MdInfo {...iconProps} color="#0c66e4" />;
            break;
        case ":dfwarn:":
            emoji = <MdOutlineWarning {...iconProps} color="#cf9f02" />;
            break;
        case ":dferror:":
            emoji = <MdCancel {...iconProps} color="#c9372c" />;
            break;
        default:
            emoji = <span className="text-xl">{props.node.attrs.emoji}</span>
            break;
    }

    return (
        <>
            <NodeViewWrapper className="react-note-component-with-content" ref={refs.setReference} {...getReferenceProps()} id={id} style={{ backgroundColor: props.node.attrs.color }}>
                <div className="flex items-start">
                    <div className="mx-2 my-2 p-2 box-border">{emoji}</div>
                    <NodeViewContent className="content flex-grow" />
                </div>
            </NodeViewWrapper>
            {(isOpen && props.editor.isEditable) && (
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>
                    <FlaotingOptions bgColor={props.node.attrs.color} updateAttributes={props.updateAttributes} handleColorSelection={handleColorSelection} />
                </div>
            )}
        </>
    );
};

export const CustomInput = Node.create({
    name: "noteBlock",
    group: "block",
    content: "inline*",

    parseHTML() {
        return [
            {
                tag: "note-block",
            },
        ];
    },

    addKeyboardShortcuts() {
        return {
            "Mod-Enter": () => {
                return this.editor.chain().insertContentAt(this.editor.state.selection.head, { type: this.type.name }).focus().run();
            },
        };
    },

    renderHTML({ HTMLAttributes }) {
        return ["note-block", mergeAttributes(HTMLAttributes), 0];
    },

    addNodeView() {
        return ReactNodeViewRenderer(NoteBlock);
    },

    addAttributes() {
        return {
            color: {
                default: "#e9f2ff",
            },
            emoji: {
                default: ":dfinfo:",
            },
        };
    },
});
