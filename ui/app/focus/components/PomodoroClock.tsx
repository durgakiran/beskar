"use client";
import { useState, useEffect, useRef } from "react";
import { Button } from "flowbite-react";
import { HiPlay, HiPause, HiRefresh } from "react-icons/hi";
import { Task } from "../types";
import { useCreateSession, useEndSession } from "../hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { useVoiceAssistant } from "app/core/hooks/useVoiceAssistant";

interface PomodoroClockProps {
    tasks: Task[];
    onTimeUpdate: (taskId: string, completedTime: number) => void;
}

export default function PomodoroClock({ tasks, onTimeUpdate }: PomodoroClockProps) {
    const [isRunning, setIsRunning] = useState(false);
    const [timeLeft, setTimeLeft] = useState(25 * 60); // 25 minutes in seconds
    const [isBreak, setIsBreak] = useState(false);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const [midSessionTriggers, setMidSessionTriggers] = useState<Set<string>>(new Set());
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const { playSessionStart, playMidSession, playSessionComplete, enabled } = useVoiceAssistant();
    
    // Session management
    const { startSession, loading: creatingSession } = useCreateSession();
    const { finishSession, loading: endingSession } = useEndSession();
    const { currentSession, setCurrentSession } = useFocusContext();

    // Get current active task
    const getCurrentTask = () => {
        const activeTasks = tasks.filter(task => 
            task.status === 'pending' || task.status === 'in-progress'
        );
        return activeTasks.length > 0 ? activeTasks[0] : null;
    };

    useEffect(() => {
        console.log("currentSession", currentSession);
    }, [currentSession]);

    const currentTask = getCurrentTask();

    // Check for mid-session audio triggers
    const checkMidSessionTriggers = (elapsedTime: number, totalTime: number) => {
        if (isBreak || !enabled) return; // Only during focus sessions
        
        const sessionKey = `${currentSession?.id}-${currentTaskId}`;
        const percentage = (elapsedTime / totalTime) * 100;
        
        // Trigger at 50% completion with a small delay
        if (percentage >= 50 && !midSessionTriggers.has(`${sessionKey}-50`)) {
            playMidSession(1000); // 1 second delay
            setMidSessionTriggers(prev => new Set([...prev, `${sessionKey}-50`]));
        }
        
        // Trigger at 75% completion with a small delay
        if (percentage >= 75 && !midSessionTriggers.has(`${sessionKey}-75`)) {
            playMidSession(1000); // 1 second delay
            setMidSessionTriggers(prev => new Set([...prev, `${sessionKey}-75`]));
        }
    };

    useEffect(() => {
        if (isRunning) {
            intervalRef.current = setInterval(() => {
                setTimeLeft((prevTime) => {
                    const totalTime = isBreak ? 5 * 60 : 25 * 60;
                    const elapsedTime = totalTime - prevTime;
                    
                    // Check for mid-session triggers
                    checkMidSessionTriggers(elapsedTime, totalTime);
                    
                    if (prevTime <= 1) {
                        // Timer finished
                        setIsRunning(false);
                        
                        // End current session
                        if (currentSession) {
                            const startTime = new Date(currentSession.startedAt).getTime();
                            const now = Date.now();
                            const actualDuration = Math.floor((now - startTime) / 60000);
                            
                            finishSession(currentSession.id, {
                                actualDuration,
                                status: 'completed'
                            });
                            playSessionComplete(1000); // 1 second delay after session completes
                            setCurrentSession(null);
                        }
                        
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
                            setMidSessionTriggers(new Set());
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
    }, [isRunning, isBreak, currentTaskId, tasks, onTimeUpdate, currentSession, finishSession, setCurrentSession, enabled, midSessionTriggers]);

    const startTimer = () => {
        if (!currentTask) return;
        
        setCurrentTaskId(currentTask.id);
        setIsRunning(true);
        
        // Reset mid-session triggers for new session
        setMidSessionTriggers(new Set());
        
        // Start a new session
        const sessionType = isBreak ? 'break' : 'pomodoro';
        const duration = isBreak ? 5 : 25;
        
        startSession({
            sessionType,
            duration,
            notes: `Working on: ${currentTask.title}`
        });

        playSessionStart(500); // 0.5 second delay after session starts
    };

    const pauseTimer = () => {
        resetTimer();
    };

    const resetTimer = () => {
        setIsRunning(false);
        setIsBreak(false);
        setTimeLeft(25 * 60);
        setCurrentTaskId(null);
        playSessionComplete();
        setMidSessionTriggers(new Set());
        
        // End current session if it exists
        if (currentSession) {
            const startTime = new Date(currentSession.startedAt).getTime();
            const now = Date.now();
            const actualDuration = Math.floor((now - startTime) / 60000);
            
            finishSession(currentSession.id, {
                actualDuration,
                status: 'interrupted'
            });
            setCurrentSession(null);
        }
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
                        disabled={!currentTask || creatingSession || endingSession}
                        className="ml-2 w-14 h-14 rounded-full flex items-center justify-center bg-blue-100 hover:bg-blue-200 border-2 border-blue-300 transition-colors focus:outline-none disabled:opacity-50"
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