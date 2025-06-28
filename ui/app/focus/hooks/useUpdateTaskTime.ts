import { usePUT } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task } from "../types";
import { useFetchTasks } from "./useFetchTasks";

export function useUpdateTaskTime() {
    const { setError } = useFocusContext();
    const [putTimeState, putTime] = usePUT<Task, { totalCompletedTime: number }>("focus/tasks");
    const { fetchTasks } = useFetchTasks();

    const updateTaskTime = (taskId: string, completedTime: number) => {
        putTime({ totalCompletedTime: completedTime }, `focus/tasks/${taskId}/time`);
        setTimeout(() => fetchTasks(), 500);
    };

    if (putTimeState.errors) {
        setError("Failed to update task time");
    }

    return {
        updateTaskTime,
        loading: putTimeState.isLoading,
        error: putTimeState.errors,
    };
}
