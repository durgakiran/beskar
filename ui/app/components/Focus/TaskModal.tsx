"use client";
import { useState, useEffect } from "react";
import { Modal, Button, TextInput, Textarea, Progress } from "flowbite-react";
import { HiTrash } from "react-icons/hi";
import { Task } from "../types";

interface TaskModalProps {
    task: Task;
    show: boolean;
    onClose: () => void;
    onUpdate: (taskId: string, updatedTask: Partial<Task>) => void;
    onDelete: (taskId: string) => void;
}

export default function TaskModal({ task, show, onClose, onUpdate, onDelete }: TaskModalProps) {
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description || "");
    const [estimatedTime, setEstimatedTime] = useState(task.estimatedTime.toString());

    useEffect(() => {
        setTitle(task.title);
        setDescription(task.description || "");
        setEstimatedTime(task.estimatedTime.toString());
    }, [task]);

    const handleSave = () => {
        if (!title.trim()) return;
        onUpdate(task.id, {
            title: title.trim(),
            description: description.trim(),
            estimatedTime: parseInt(estimatedTime) || 30,
        });
        onClose();
    };

    const handleDelete = () => {
        onDelete(task.id);
    };

    const progress = task.completedTime && task.estimatedTime
        ? Math.round((task.completedTime / task.estimatedTime) * 100)
        : 0;

    const formatTime = (minutes: number) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0) {
            return `${hours}h${mins}m`;
        }
        return `${mins}m`;
    };

    return (
        <Modal show={show} onClose={onClose} size="lg" theme={{ content: { base: "bg-white rounded-xl shadow-md max-w-xl w-full" } }}>
            <div className="px-8 py-6">
                {/* Header row */}
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Edit Task</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1 rounded transition-colors">
                        <span aria-label="Close">×</span>
                    </button>
                </div>
                {/* Title and time row */}
                <div className="flex gap-2 mb-3">
                    <TextInput
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Task title"
                        className="flex-1 text-base font-medium text-gray-900 bg-gray-50 border border-gray-200 focus:ring-1 focus:ring-blue-200 focus:border-blue-400"
                    />
                    <TextInput
                        type="number"
                        value={estimatedTime}
                        onChange={(e) => setEstimatedTime(e.target.value)}
                        placeholder="25m"
                        min="1"
                        className="w-20 text-base bg-gray-50 border border-gray-200 focus:ring-1 focus:ring-blue-200 focus:border-blue-400"
                    />
                </div>
                {/* Description */}
                <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description (optional)"
                    rows={3}
                    className="w-full text-base bg-gray-50 border border-gray-200 focus:ring-1 focus:ring-blue-200 focus:border-blue-400 mb-6"
                />
                {/* Bottom row: delete and save */}
                <div className="flex items-center justify-between mt-2">
                    <button
                        onClick={handleDelete}
                        className="text-red-500 hover:text-red-700 p-1 w-9 h-9 flex items-center justify-center rounded-full transition-colors border border-transparent hover:border-red-200 bg-red-50"
                        title="Delete task"
                    >
                        <HiTrash className="w-5 h-5" />
                    </button>
                    <Button
                        onClick={handleSave}
                        color="blue"
                        size="xs"
                        className="p-1 w-9 h-9 flex items-center justify-center rounded-full shadow-none focus:ring-2 focus:ring-blue-200 focus:outline-none"
                        title="Save changes"
                    >
                        <span className="sr-only">Save</span>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    </Button>
                </div>
            </div>
        </Modal>
    );
} 