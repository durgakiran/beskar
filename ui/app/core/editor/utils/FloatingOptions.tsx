import Emoji from "@editor/emoji/Emoji";
import ColorPicker from "./ColorPicker";
import NoteTypeButtons from "./NoteTypeButtons";

interface IProps {
    bgColor: string;
    handleColorSelection: (color: string) => void;
    updateAttributes: any // function to update editor props
}

export function FlaotingOptions(props: IProps) {
    return (
        <div className="flex shadow rounded-sm px-2 py-1 z-[9999] items-center gap-2">
            <NoteTypeButtons updateAttributes={props.updateAttributes} />
            <Emoji  updateAttributes={props.updateAttributes} />
            <ColorPicker bgColor={props.bgColor} handleColorSelection={props.handleColorSelection} />
        </div>
    );
}
