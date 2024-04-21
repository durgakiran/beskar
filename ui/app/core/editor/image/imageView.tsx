import { Editor, NodeViewWrapper } from "@tiptap/react";
import { useLoadImage } from "app/core/http/uploadImageData";
import { FocusEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";


interface EventDetails {
    name: "parent" | "child";
    focus: boolean;
}

function useEventDebounce(event, delay) {
    const [events, setEvents] = useState<EventDetails[]>([]);
    const [active, setActive] = useState(false);

    useEffect(() => {
        if (event) {
            setEvents([...events, event]);
        }
    }, [event]);

    useEffect(() => {
        let handler;
        if (events.length) {
            handler = setTimeout(() => {
                const isActive = events.reduce((p, c) => {
                    return p || c.focus;
                }, false);
                setActive(isActive);
                setEvents([]);
            }, delay);
        }

        return () => {
            clearTimeout(handler);
        }

    }, [events]);

    return active;
}

export default function ImageView(props) {
    const [blockActive, setBlockActive] = useState(false);
    const [imageActive, setImageActive] = useState(false);
    const [captionActive, setCaptionActive] = useState(false);
    const data = useLoadImage(props.node.attrs.src);
    const parentRef = useRef(null);
    const imageEditableRef = useRef(null);
    const altTextRef = useRef(null);
    const [event, setEvent] = useState(null);
    const debouncedEvent = useEventDebounce(event, 10);

    useEffect(() => {
        setBlockActive(debouncedEvent);
    }, [debouncedEvent]);

    const handleImageFocus = (ev: FocusEvent<HTMLDivElement, Element>) => {
        const eventDetails: EventDetails = {
            name: "child",
            focus: true,
        }
        setEvent(eventDetails);
        setImageActive(true);
    };

    const handleImageBlur = (ev: FocusEvent<HTMLDivElement, Element>) => {
        ev.stopPropagation();
        const eventDetails: EventDetails = {
            name: "child",
            focus: false,
        }
        setEvent(eventDetails);
        setTimeout(() =>  setImageActive(false));
    };

    const handleCaptionActive = (ev: FocusEvent<HTMLDivElement, Element>) => {
        const eventDetails: EventDetails = {
            name: "child",
            focus: true,
        }
        setEvent(eventDetails);
        setCaptionActive(true);
    };

    const handleEnter = (event: KeyboardEvent) => {
        if (event.key.toLowerCase() === "enter") {
            event.preventDefault();
        }
    };

    const handleInput = (event: FocusEvent) => {
        props.updateAttributes({
            alt: (event.target as HTMLElement).innerText,
        });
        event.stopPropagation();
        const eventDetails: EventDetails = {
            name: "child",
            focus: false,
        }
        setEvent(eventDetails);
        setTimeout(() =>  setCaptionActive(false));
    };

    return (
        <NodeViewWrapper>
            <div contentEditable="false" ref={parentRef}  >
                <div className="img-container rounded m-auto my-4 relative" contentEditable="false">
                    <div className="img-wrapper px-2 w-full h-full flex items-center justify-center focus:outline-1" contentEditable="false" onBlur={(ev) => handleImageBlur(ev)} onFocus={handleImageFocus}>
                        {(imageActive) && <div className="h-16 w-1 rounded bg-blue-500 cursor-move" contentEditable="false"></div>}
                        <div ref={imageEditableRef} className="focus-visible:outline-none mx-2 caret-teal-500" contentEditable={props.editor.isEditable}>
                            <div className={"img-content box-border " + ((imageActive) ? "border rounded border-blue-500" : "")}>
                                {data && <img className="object-cover box-border rounded" src={data} height={props.node.attrs.height} width={props.node.attrs.width} alt={props.node.attrs.alt} />}
                            </div>
                        </div>
                        {(imageActive) && <div className="h-16 w-1 rounded bg-blue-500 cursor-move" contentEditable="false"></div>}
                    </div>
                    {blockActive && (
                        <div contentEditable={false}>
                            <div
                                ref={altTextRef}
                                onKeyDown={handleEnter}
                                onBlur={handleInput}
                                onFocus={handleCaptionActive}
                                contentEditable={props.editor.isEditable}
                                data-placeholder="Add a caption"
                                className="img-alt opacity-10 text-center focus-visible:outline-none p-2 m-2 text-gray-500"
                            >
                                {props.node.attrs.alt}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </NodeViewWrapper>
    );
}
