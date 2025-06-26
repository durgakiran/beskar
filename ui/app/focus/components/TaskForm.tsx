"use client";
import { useState, KeyboardEvent } from "react";
import { TextInput } from "flowbite-react";
import { TaskFormData } from "../types";

interface TaskFormProps {
    onSubmit: (task: TaskFormData) => void;
    disabled?: boolean;
}

export default function TaskForm({ onSubmit, disabled = false }: TaskFormProps) {
    const [title, setTitle] = useState("");
    const [estimatedTime, setEstimatedTime] = useState("");

    const handleSubmit = () => {
        if (!title.trim() || disabled) return;
        
        const timeValue = parseInt(estimatedTime) || 30; // default to 30 minutes
        
        onSubmit({
            title: title.trim(),
            description: "", // empty description
            estimatedTime: timeValue,
            priority: "medium", // default priority
        });

        // Reset form
        setTitle("");
        setEstimatedTime("");
    };

    const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !disabled) {
            handleSubmit();
        }
    };

    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                <TextInput
                    type="text"
                    placeholder={disabled ? "Max tasks reached" : "What are you working on?"}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="flex-1"
                    disabled={disabled}
                    autoFocus
                />
                <TextInput
                    type="number"
                    placeholder="30"
                    value={estimatedTime}
                    onChange={(e) => setEstimatedTime(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="w-16"
                    disabled={disabled}
                    min="1"
                />
                <span className="flex items-center text-xs text-gray-500">
                    min
                </span>
            </div>
            
            <div className="text-xs text-gray-400">
                {disabled ? "Maximum 3 tasks allowed" : "Press Enter to add task"}
            </div>
        </div>
    );
} 