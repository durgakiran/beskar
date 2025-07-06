import { usePUT } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task } from "../types";
import { useFetchTasks } from "./useFetchTasks";
import { useEffect, useRef } from "react";

export function useUpdateTask() {
    const { setError } = useFocusContext();
    const [{ isLoading, data, errors }, putTask] = usePUT<Task, Partial<Task>>("focus/tasks");
    const { fetchTasks } = useFetchTasks();
    const wasLoadingRef = useRef(false);

    const updateTask = (taskId: string, updatedTask: Partial<Task>) => {
        putTask({ ...updatedTask, id: taskId });
    };

    // Trigger fetchTasks when loading changes from true to false (operation completes)
    useEffect(() => {
        if (wasLoadingRef.current && !isLoading) {
            fetchTasks();
        }
        wasLoadingRef.current = isLoading;
    }, [isLoading, fetchTasks]);

    if (errors) {
        setError("Failed to update task");
    }

    return {
        updateTask,
        loading: isLoading,
        error: errors,
    };
}
