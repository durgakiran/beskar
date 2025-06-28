"use client";
import { useState } from "react";
import { Task } from "../types";
import { HiCheck } from "react-icons/hi";

interface TaskCardProps {
    task: Task;
    index: number;
    onStatusChange: (taskId: string, status: Task['status']) => void;
    onDelete: (taskId: string) => void;
    onTimeUpdate: (taskId: string, completedTime: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onTaskClick: (task: Task) => void;
    totalTasks: number;
}

export default function TaskCard({ 
    task, 
    index, 
    onStatusChange, 
    onDelete, 
    onTimeUpdate, 
    onReorder, 
    onTaskClick,
    totalTasks 
}: TaskCardProps) {
    const [isDragging, setIsDragging] = useState(false);

    const formatTime = (minutes: number) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        return `${mins}m`;
    };

    const handleStatusChange = (newStatus: Task['status']) => {
        onStatusChange(task.id, newStatus);
    };

    const handleDragStart = (e: React.DragEvent) => {
        setIsDragging(true);
        e.dataTransfer.setData('text/plain', index.toString());
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
        if (fromIndex !== index) {
            onReorder(fromIndex, index);
        }
    };

    const handleDragEnd = () => {
        setIsDragging(false);
    };

    const handleCardClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) {
            return;
        }
        onTaskClick(task);
    };

    // Calculate progress percentage
    const progress = task.totalCompletedTime ? (task.totalCompletedTime / task.estimatedTime) * 100 : 0;

    // Color logic
    let bg = "bg-white text-gray-900";
    let border = "border border-gray-200";
    if (progress >= 100) {
        bg = "bg-red-50 text-red-900";
    } else if (task.status === 'completed') {
        bg = "bg-green-50 text-green-900";
    }
    if (index === 0) {
        border = progress >= 100 ? "border-2 border-yellow-400" : "border-2 border-yellow-400";
    } else {
        border = "border border-gray-200";
    }

    return (
        <div
            className={`flex items-center gap-2 px-3 py-2 mb-1 rounded-lg shadow-sm cursor-pointer select-none transition-all duration-150 ${bg} ${border} ${isDragging ? 'opacity-60' : ''}`}
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onClick={handleCardClick}
        >
            {/* Radio Button */}
            <button
                onClick={e => { e.stopPropagation(); handleStatusChange(task.status === 'completed' ? 'pending' : 'completed'); }}
                className={`w-5 h-5 flex items-center justify-center rounded-full border-2 mr-2 transition-all duration-150 ${task.status === 'completed' ? 'bg-green-400 border-green-400' : 'border-gray-300 bg-white'}`}
                title={task.status === 'completed' ? 'Mark as pending' : 'Mark as completed'}
            >
                {task.status === 'completed' && <HiCheck className="w-3 h-3 text-white" />}
            </button>
            {/* Task Title */}
            <div className={`flex-1 truncate font-medium text-sm ${task.status === 'completed' ? 'line-through text-gray-300' : ''}`}>{task.title}</div>
            {/* Time */}
            <div className="ml-2 text-xs font-medium text-gray-400 whitespace-nowrap opacity-80">
                {formatTime(task.totalCompletedTime || 0)} / {formatTime(task.estimatedTime)}
            </div>
        </div>
    );
} 