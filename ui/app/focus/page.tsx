"use client";
import { useState, useEffect } from "react";
import { Card } from "flowbite-react";
import FocusStats from "./components/FocusStats";
import PomodoroClock from "./components/PomodoroClock";
import { Task } from "./types";
import TaskModal from "../components/Focus/TaskModal";
import Tabs from "../components/Focus/Tabs";
import TaskList from "../components/Focus/TaskList";
import TaskCard from "../components/Focus/TaskCard";
import TaskAddForm from "../components/Focus/TaskAddForm";
import { FocusProvider, useFocusContext } from "../core/context/FocusContext";
import { useFetchTasks } from "./hooks/useFetchTasks";
import { useAddTask } from "./hooks/useAddTask";
import { useUpdateTask } from "./hooks/useUpdateTask";
import { useDeleteTask } from "./hooks/useDeleteTask";
import { useUpdateTaskStatus } from "./hooks/useUpdateTaskStatus";
import { useUpdateTaskTime } from "./hooks/useUpdateTaskTime";
import { useReorderTasks } from "./hooks/useReorderTasks";
import { useFocusStats } from "./hooks/useFocusStats";

function FocusPageContent() {
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [activeTab, setActiveTab] = useState('tasks');
    
    const { tasks, stats, loading, error } = useFocusContext();
    
    // Individual hooks for different operations
    const { fetchTasks } = useFetchTasks();
    const { addTask } = useAddTask();
    const { updateTask } = useUpdateTask();
    const { deleteTask } = useDeleteTask();
    const { updateTaskStatus } = useUpdateTaskStatus();
    const { updateTaskTime } = useUpdateTaskTime();
    const { activeTasks, reorderActiveTasks } = useReorderTasks();
    const { loadStats } = useFocusStats();

    // Load initial data
    useEffect(() => {
        fetchTasks();
        loadStats();
    }, []);

    // Sort tasks by taskOrder
    const sortedTasks = [...tasks].sort((a, b) => a.taskOrder - b.taskOrder);

    const handleTaskClick = (task: Task) => {
        setSelectedTask(task);
        setShowModal(true);
    };

    const closeModal = () => {
        setShowModal(false);
        setSelectedTask(null);
    };

    // Get current active task (top of the list)
    const getCurrentTask = () => {
        return activeTasks.length > 0 ? activeTasks[0] : null;
    };

    const currentTask = getCurrentTask();

    // Show loading state
    if (loading) {
        return (
            <div className="h-screen p-3 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading your focus tasks...</p>
                </div>
            </div>
        );
    }

    // Show error state
    if (error) {
        return (
            <div className="h-screen p-3 flex items-center justify-center">
                <div className="text-center">
                    <div className="text-red-500 mb-4">
                        <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load tasks</h3>
                    <p className="text-gray-600 mb-4">{error}</p>
                    <button 
                        onClick={() => window.location.reload()} 
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen p-3">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 max-h-screen">
                {/* First Column - Tabbed Features in a Card */}
                <div className="lg:col-span-1 flex flex-col h-full">
                    <Card className="shadow-sm flex flex-col h-full">
                        <div className="mb-3">
                            <Tabs activeTab={activeTab} onTabChange={setActiveTab} />
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {activeTab === 'tasks' && (
                                <TaskList
                                    tasks={sortedTasks}
                                    onAdd={(title, estimatedTime) => {
                                        addTask({ title, description: '', estimatedTime, priority: 'medium' });
                                    }}
                                    onStatusChange={updateTaskStatus}
                                    onDelete={deleteTask}
                                    onTimeUpdate={updateTaskTime}
                                    onReorder={reorderActiveTasks}
                                    onTaskClick={handleTaskClick}
                                />
                            )}
                            {activeTab === 'notes' && (
                                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                                    Quick Notes (coming soon)
                                </div>
                            )}
                            {activeTab === 'settings' && (
                                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                                    Settings (coming soon)
                                </div>
                            )}
                        </div>
                    </Card>
                </div>

                {/* Second Column - Current Task & Timer + Music Placeholder */}
                <div className="lg:col-span-1 flex flex-col h-full gap-3">
                    {/* Top: Current Session Details (no card) */}
                    <div className="bg-gray-50 rounded-xl p-4 flex flex-col items-center justify-center h-[260px]">
                        <div className="mb-3 w-full">
                            {currentTask ? (
                                <div className="mb-2 p-2 bg-white border border-blue-100 rounded-xl text-center">
                                    <p className="font-medium text-gray-900 text-base line-clamp-2" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{currentTask.title}</p>
                                </div>
                            ) : (
                                <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                                    <p className="text-xs text-yellow-700">
                                        No active task. Add a task to start focusing!
                                    </p>
                                </div>
                            )}
                            <PomodoroClock tasks={sortedTasks} onTimeUpdate={updateTaskTime} />
                        </div>
                    </div>
                    {/* Bottom: Music Integration Placeholder */}
                    <Card className="flex-1 flex items-center justify-center shadow-sm">
                        {/* Future: Music integration goes here */}
                    </Card>
                </div>

                {/* Third Column - Task Management & Statistics */}
                <div className="lg:col-span-1 flex flex-col h-full">
                    {/* Task Management Card */}
                    <Card className="shadow-sm mb-3 flex flex-col h-[260px]">
                        <div className="flex justify-between items-center mb-3 flex-shrink-0">
                            <h3 className="text-sm font-medium text-gray-700">
                                Current Session Tasks
                            </h3>
                        </div>
                        <div className="overflow-hidden flex flex-col justify-between h-full">
                            <div className="overflow-y-auto pr-1 flex flex-col gap-2">
                                {activeTasks.slice(0, 3).map((task, index) => (
                                    <TaskCard
                                        key={task.id}
                                        task={task}
                                        index={index}
                                        onStatusChange={updateTaskStatus}
                                        onDelete={deleteTask}
                                        onTimeUpdate={updateTaskTime}
                                        onReorder={() => {}} // No reorder in this view
                                        onTaskClick={handleTaskClick}
                                        totalTasks={activeTasks.length}
                                    />
                                ))}
                                {activeTasks.length < 3 && (
                                    <div className="flex gap-2 items-center">
                                        <TaskAddForm
                                            onAdd={(title, estimatedTime) => {
                                                addTask({ title, description: '', estimatedTime, priority: 'medium' });
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    {/* Statistics Card */}
                    <Card className="shadow-sm flex-shrink-0">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">
                            Focus Statistics
                        </h3>
                        <FocusStats stats={stats} />
                    </Card>
                </div>
            </div>

            {/* Task Modal */}
            {selectedTask && (
                <TaskModal
                    task={selectedTask}
                    show={showModal}
                    onClose={closeModal}
                    onUpdate={updateTask}
                    onDelete={deleteTask}
                />
            )}
        </div>
    );
}

export default function FocusPage() {
    return (
        <FocusProvider>
            <FocusPageContent />
        </FocusProvider>
    );
} 