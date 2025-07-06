import { usePost } from "@http/hooks";
import { SessionTask, AddTaskToSessionRequest } from "../types";

export function useAddTaskToSession() {
    const [addTaskToSessionState, addTaskToSession] = usePost<{ status: string; data: SessionTask }, AddTaskToSessionRequest>("focus/sessions");
    
    const addTask = (sessionId: string, taskData: AddTaskToSessionRequest) => {
        addTaskToSession(taskData, `focus/sessions/${sessionId}/tasks`);
    };

    return {
        sessionTask: addTaskToSessionState.data?.data,
        loading: addTaskToSessionState.isLoading,
        error: addTaskToSessionState.errors,
        addTask,
    };
} 