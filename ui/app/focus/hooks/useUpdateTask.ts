import { usePUT } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task } from "../types";
import { useFetchTasks } from "./useFetchTasks";

export function useUpdateTask() {
    const { setError } = useFocusContext();
    const [putTaskState, putTask] = usePUT<Task, Partial<Task>>("focus/tasks");
    const { fetchTasks } = useFetchTasks();

    const updateTask = (taskId: string, updatedTask: Partial<Task>) => {
        putTask({ ...updatedTask, id: taskId });
        setTimeout(() => fetchTasks(), 500);
    };

    if (putTaskState.errors) {
        setError("Failed to update task");
    }

    return {
        updateTask,
        loading: putTaskState.isLoading,
        error: putTaskState.errors,
    };
}
