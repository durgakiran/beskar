import { useState } from "react";

interface TaskAddFormProps {
    onAdd: (title: string, estimatedTime: number) => void;
}

export default function TaskAddForm({ onAdd }: TaskAddFormProps) {
    const [title, setTitle] = useState("");
    const [estimatedTime, setEstimatedTime] = useState("25");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd(title, parseInt(estimatedTime) || 25);
        setTitle("");
        setEstimatedTime("25");
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (!title.trim()) return;
            onAdd(title, parseInt(estimatedTime) || 25);
            setTitle("");
            setEstimatedTime("25");
        }
    };

    return (
        <form className="flex w-full gap-2" onSubmit={handleSubmit}>
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="+ Add a Task here"
                className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 placeholder-gray-400"
                onKeyDown={handleKeyDown}
            />
            <input
                type="number"
                value={estimatedTime}
                onChange={(e) => setEstimatedTime(e.target.value)}
                min="1"
                className="w-16 rounded-full border border-gray-300 bg-white px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                onKeyDown={handleKeyDown}
            />
        </form>
    );
}
