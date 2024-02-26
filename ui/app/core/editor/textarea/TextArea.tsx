
interface textAreaProps {
    value: string;
    handleInput: (value: string) => void;
}

export default function TextArea({value, handleInput}: textAreaProps) {
    return (
        <textarea placeholder="Please Enter title" value={value} onInput={(ev) => handleInput((ev.target as HTMLTextAreaElement).value)} ></textarea>
    )
}
