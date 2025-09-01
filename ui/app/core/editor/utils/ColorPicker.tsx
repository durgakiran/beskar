import { useId, useRef, useState } from "react";
import "./colorPicker.css";
import { HiChevronDown } from "react-icons/hi";
import { SubtleColors, SubtlerColors, SubtlestColors } from "./Colors";
import { HiCheck } from "react-icons/hi";
import { useFloating, autoUpdate, offset, flip, shift, useClick, useInteractions } from "@floating-ui/react";

interface ColorOptionProps {
    selected: string;
    handleColorSelection: (color: string) => void;
}

function ColorOptions({ selected, handleColorSelection }: ColorOptionProps) {

    return (
        <div className="flex flex-col gap-2 p-4 shadow-sm rounded bg-white">
            <div className="flex flex-nowrap gap-2 ">
                {SubtlestColors.map((color, index) => {
                    return selected === color.color ? (
                        <button onClick={() => handleColorSelection(color.color)} key={index} style={{ backgroundColor: color.color }} title={color.title} className="w-6 h-6 border rounded text-center">
                            <HiCheck className="m-auto"/>
                        </button>
                    ) : (
                        <button onClick={() => handleColorSelection(color.color)} key={index} style={{ backgroundColor: color.color }} title={color.title} className="w-6 h-6 border rounded" />
                    );
                })}
            </div>
            <div className="flex flex-nowrap gap-2 ">
                {SubtlerColors.map((color, index) => {
                    return selected === color.color ? (
                        <button onClick={() => handleColorSelection(color.color)} key={index} style={{ backgroundColor: color.color }} title={color.title} className="w-6 h-6 border rounded text-center">
                            <HiCheck />
                        </button>
                    ) : (
                        <button onClick={() => handleColorSelection(color.color)} key={index} style={{ backgroundColor: color.color }} title={color.title} className="w-6 h-6 border rounded" />
                    );
                })}
            </div>
            <div className="flex flex-nowrap gap-2 ">
                {SubtleColors.map((color, index) => {
                    return selected === color.color ? (
                        <button onClick={() => handleColorSelection(color.color)} key={index} style={{ backgroundColor: color.color }} title={color.title} className="w-6 h-6 border rounded text-center">
                            <HiCheck />
                        </button>
                    ) : (
                        <button onClick={() => handleColorSelection(color.color)} key={index} style={{ backgroundColor: color.color }} title={color.title} className="w-6 h-6 border rounded" />
                    );
                })}
            </div>
        </div>
    );
}

export default function ColorPicker(props: { bgColor: string; handleColorSelection: (color: string) => void; }) {
    const id = useId();
    const ref = useRef();
    const { bgColor, handleColorSelection } = props;
    const [isOpen, setIsOpen] = useState(false);
    const { refs, floatingStyles, context } = useFloating({ whileElementsMounted: autoUpdate, open: isOpen, onOpenChange: setIsOpen, middleware: [offset(20), flip(), shift()] });
    const click = useClick(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([click]);

    return (
        <>
            <button className="flex hover:bg-slate-100 p-1 rounded-sm" title="Background color" ref={refs.setReference} {...getReferenceProps()} id={id}>
                <span className="w-4 h-4 border rounded" style={{ backgroundColor: bgColor }}></span>
                <span className="pl-2">
                    <HiChevronDown size={16} />
                </span>
            </button>
            {isOpen && (
                <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-[9999]">
                    <ColorOptions selected={bgColor} handleColorSelection={handleColorSelection} />
                </div>
            )}
        </>
    );
}
