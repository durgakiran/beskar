import { useGet } from "@http/hooks";
import { SessionTask } from "../types";

export function useSessionTasks() {
    const [getSessionTasksState, fetchSessionTasks] = useGet<{ status: string; data: SessionTask[] }>("focus/sessions");
    
    const loadSessionTasks = (sessionId: string) => {
        fetchSessionTasks({}, `focus/sessions/${sessionId}/tasks`);
    };

    return {
        sessionTasks: getSessionTasksState.data?.data || [],
        loading: getSessionTasksState.isLoading,
        error: getSessionTasksState.errors,
        loadSessionTasks,
    };
} 