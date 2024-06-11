import { MdOutlineWarning } from "react-icons/md";
import { MdInfo } from "react-icons/md";
import { BiSolidNotepad } from "react-icons/bi";
import { MdCancel } from "react-icons/md";

export default function NoteTypeButtons(props: { updateAttributes: any }) {
    const handleChangeNoteType = (type: string) => {
        switch (type) {
            case "info":
                props.updateAttributes({ color: "#e9f2ff", emoji: ":dfinfo:" });
                break;
            case "note":
                props.updateAttributes({ color: "#f3f0ff", emoji: ":dfnote:" });
                break;
            case "warn":
                props.updateAttributes({ color: "#fff7d6", emoji: ":dfwarn:" });
                break;
            case "error":
                props.updateAttributes({ color: "#ffeceb", emoji: ":dferror:" });
                break;
            default:
                break;
        }
    };

    return (
        <div className="flex gap-2">
            <button className="hover:bg-slate-100 p-1 rounded-sm" onClick={() => handleChangeNoteType("info")}>
                <MdInfo />
            </button>
            <button className="hover:bg-slate-100 p-1 rounded-sm" onClick={() => handleChangeNoteType("note")}>
                <BiSolidNotepad />
            </button>
            <button className="hover:bg-slate-100 p-1 rounded-sm" onClick={() => handleChangeNoteType("warn")}>
                <MdOutlineWarning />
            </button>
            <button className="hover:bg-slate-100 p-1 rounded-sm" onClick={() => handleChangeNoteType("error")}>
                <MdCancel />
            </button>
        </div>
    );
}
