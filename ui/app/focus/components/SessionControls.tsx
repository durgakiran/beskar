"use client";
import { useCreateSession, useEndSession } from "../hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { CreateSessionRequest, EndSessionRequest } from "../types";

export default function SessionControls() {
    const { currentSession, setCurrentSession } = useFocusContext();
    const { startSession, loading: creating } = useCreateSession();
    const { finishSession, loading: ending } = useEndSession();

    const handleStartSession = (type: "pomodoro" | "break" | "long_break") => {
        const duration = type === "pomodoro" ? 25 : type === "break" ? 5 : 15;
        const sessionData: CreateSessionRequest = {
            sessionType: type,
            duration,
            notes: "",
        };
        startSession(sessionData);
    };

    const handleEndSession = () => {
        if (!currentSession) return;

        // Calculate actual duration (in minutes)
        const startTime = new Date(currentSession.startedAt).getTime();
        const now = Date.now();
        const actualDuration = Math.floor((now - startTime) / 60000); // Convert to minutes

        const endData: EndSessionRequest = {
            actualDuration,
            status: "completed",
        };

        finishSession(currentSession.id, endData);
        setCurrentSession(null);
    };

    return (
        <div className="p-4">
            <h3 className="text-lg font-semibold mb-4">Session Controls</h3>

            {!currentSession ? (
                <div className="space-y-2">
                    <button
                        onClick={() => handleStartSession("pomodoro")}
                        disabled={creating}
                        className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                        Start Pomodoro (25 min)
                    </button>
                    <button
                        onClick={() => handleStartSession("break")}
                        disabled={creating}
                        className="w-full px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                        Start Break (5 min)
                    </button>
                    <button
                        onClick={() => handleStartSession("long_break")}
                        disabled={creating}
                        className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
                    >
                        Start Long Break (15 min)
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded">
                        <p className="font-medium">Active Session</p>
                        <p className="text-sm text-gray-600">
                            {currentSession.sessionType.replace("_", " ")} • {currentSession.duration} minutes
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Started: {new Date(currentSession.startedAt).toLocaleTimeString()}</p>
                    </div>
                    <button onClick={handleEndSession} disabled={ending} className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors">
                        End Session
                    </button>
                </div>
            )}
        </div>
    );
}
