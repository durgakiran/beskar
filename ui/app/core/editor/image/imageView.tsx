import { Editor, NodeViewWrapper } from "@tiptap/react";
import { FocusEvent, FormEvent, KeyboardEvent, useState } from "react";

export default function ImageView(props) {
    const [imageActive, setImageActive] = useState(false);
    const [captionActive, setCaptionActive] = useState(false);

    const handleImageContainerClick = () => {
        console.log((props.editor as Editor).isEditable);
    }

    const handleEnter = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() === "enter") {
            event.preventDefault();
        }
    }

    const handleInput = (event: FocusEvent) => {
        props.updateAttributes({
            alt: (event.target as HTMLElement).innerText,
        })
    }

    return (
        <NodeViewWrapper>
            <div className="img-container rounded m-auto my-4 relative" contentEditable={true} style={{ width: "760px", height: "400px" }}>
                <div className="img-wrapper px-2 w-full h-full" onFocus={handleImageContainerClick}>
                    <div className="focus-visible:outline-none caret-teal-500" contentEditable={true}>
                        <div className="img-content px-2 w-full h-full" >
                            <img className="object-cover px-2 box-border rounded" src={props.node.attrs.src} alt={props.node.attrs.alt} />
                        </div>
                    </div>
                </div>
                <div contentEditable={false}>
                    <div
                        onKeyDown={handleEnter}
                        onBlur={handleInput}
                        contentEditable={true}
                        data-placeholder="Add a caption"
                        className="img-alt opacity-10 text-center focus-visible:outline-none p-2 m-2 text-gray-500">
                        {props.node.attrs.alt}
                    </div>
                </div>
            </div>
        </NodeViewWrapper>
    )
}
