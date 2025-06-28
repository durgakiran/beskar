"use client";
import { useState, useEffect, useRef } from "react";
import { Button } from "flowbite-react";
import { HiPlay, HiPause, HiRefresh } from "react-icons/hi";
import { Task } from "../types";

interface PomodoroClockProps {
    tasks: Task[];
    onTimeUpdate: (taskId: string, completedTime: number) => void;
}

export default function PomodoroClock({ tasks, onTimeUpdate }: PomodoroClockProps) {
    const [isRunning, setIsRunning] = useState(false);
    const [timeLeft, setTimeLeft] = useState(25 * 60); // 25 minutes in seconds
    const [isBreak, setIsBreak] = useState(false);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    // Get current active task
    const getCurrentTask = () => {
        const activeTasks = tasks.filter(task => 
            task.status === 'pending' || task.status === 'in-progress'
        );
        return activeTasks.length > 0 ? activeTasks[0] : null;
    };

    const currentTask = getCurrentTask();

    useEffect(() => {
        if (isRunning) {
            intervalRef.current = setInterval(() => {
                setTimeLeft((prevTime) => {
                    if (prevTime <= 1) {
                        // Timer finished
                        setIsRunning(false);
                        
                        if (currentTaskId) {
                            // Update task time
                            const currentTask = tasks.find(t => t.id === currentTaskId);
                            if (currentTask) {
                                const sessionTime = isBreak ? 5 * 60 : 25 * 60; // 5 min break or 25 min focus
                                const newCompletedTime = (currentTask.totalCompletedTime || 0) + sessionTime;
                                onTimeUpdate(currentTaskId, newCompletedTime);
                            }
                        }

                        // Switch between focus and break
                        if (isBreak) {
                            // Break finished, start focus session
                            setIsBreak(false);
                            setTimeLeft(25 * 60);
                            return 25 * 60;
                        } else {
                            // Focus finished, start break
                            setIsBreak(true);
                            setTimeLeft(5 * 60);
                            return 5 * 60;
                        }
                    }
                    return prevTime - 1;
                });
            }, 1000);
        } else {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        }

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [isRunning, isBreak, currentTaskId, tasks, onTimeUpdate]);

    const startTimer = () => {
        if (!currentTask) return;
        
        setCurrentTaskId(currentTask.id);
        setIsRunning(true);
    };

    const pauseTimer = () => {
        setIsRunning(false);
    };

    const resetTimer = () => {
        setIsRunning(false);
        setIsBreak(false);
        setTimeLeft(25 * 60);
        setCurrentTaskId(null);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // Label logic
    let label = '';
    if (isRunning && !isBreak) label = 'Focusing';
    else if (isRunning && isBreak) label = 'Chilling';
    else label = 'Paused';

    return (
        <div className="flex flex-col items-center justify-center w-full">
            <div className="text-center mb-2">
                <div className="text-base text-gray-500 font-medium mb-1" style={{letterSpacing: 1}}>{label}</div>
                <div className="flex items-center justify-center gap-4">
                    <span className="text-[56px] md:text-[64px] font-extrabold text-blue-700 drop-shadow-none" style={{fontVariantNumeric:'tabular-nums'}}>
                        {formatTime(timeLeft)}
                    </span>
                    <button
                        onClick={isRunning ? pauseTimer : startTimer}
                        disabled={!currentTask}
                        className="ml-2 w-14 h-14 rounded-full flex items-center justify-center bg-blue-100 hover:bg-blue-200 border-2 border-blue-300 transition-colors focus:outline-none"
                        title={isRunning ? 'Pause' : 'Start'}
                    >
                        {isRunning ? (
                            <HiPause className="w-8 h-8 text-blue-600" />
                        ) : (
                            <HiPlay className="w-8 h-8 text-blue-600" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
} 