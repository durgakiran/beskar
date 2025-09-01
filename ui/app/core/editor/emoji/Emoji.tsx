import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { MdOutlineAddReaction } from "react-icons/md";
import { useFloating, autoUpdate, offset, flip, shift, useClick, useInteractions } from "@floating-ui/react";
import { useState } from "react";

export default function Emoji(props: { updateAttributes: any }) {
    const [isOpen, setIsOpen] = useState(false);
    const { refs, floatingStyles, context } = useFloating({ whileElementsMounted: autoUpdate, open: isOpen, onOpenChange: setIsOpen, middleware: [offset(20), flip(), shift()] });
    const click = useClick(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([click]);

    const handleEmojiUpdate = (ev: any) => {
        // shortcodes
        console.log(props);
        props.updateAttributes({ emoji: ev.native ?? "" })
    }


    return (
        <>
            <button ref={refs.setReference} {...getReferenceProps()} className="hover:bg-slate-100 p-1 rounded-sm">
                <MdOutlineAddReaction />
            </button>
            {isOpen && (
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[9999]">
                    <Picker data={data} theme="light" onEmojiSelect={handleEmojiUpdate} />
                </div>
            )}
        </>
    );
}
