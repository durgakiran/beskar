import { usePUT } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task } from "../types";
import { useFetchTasks } from "./useFetchTasks";

export function useUpdateTaskStatus() {
    const { setError } = useFocusContext();
    const [putStatusState, putStatus] = usePUT<Task, { status: Task["status"] }>("focus/tasks");
    const { fetchTasks } = useFetchTasks();

    const updateTaskStatus = (taskId: string, status: Task["status"]) => {
        putStatus({ status }, `focus/tasks/${taskId}/status`);
        setTimeout(() => fetchTasks(), 500);
    };

    if (putStatusState.errors) {
        setError("Failed to update task status");
    }

    return {
        updateTaskStatus,
        loading: putStatusState.isLoading,
        error: putStatusState.errors,
    };
}
