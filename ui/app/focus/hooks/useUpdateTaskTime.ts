import { usePUT } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task } from "../types";
import { useFetchTasks } from "./useFetchTasks";
import { useEffect, useRef } from "react";

export function useUpdateTaskTime() {
    const { setError } = useFocusContext();
    const [{ isLoading, data, errors }, putTime] = usePUT<Task, { totalCompletedTime: number }>("focus/tasks");
    const { fetchTasks } = useFetchTasks();
    const wasLoadingRef = useRef(false);

    const updateTaskTime = (taskId: string, completedTime: number) => {
        putTime({ totalCompletedTime: completedTime }, `focus/tasks/${taskId}/time`);
    };

    // Trigger fetchTasks when loading changes from true to false (operation completes)
    useEffect(() => {
        if (wasLoadingRef.current && !isLoading) {
            fetchTasks();
        }
        wasLoadingRef.current = isLoading;
    }, [isLoading, fetchTasks]);

    if (errors) {
        setError("Failed to update task time");
    }

    return {
        updateTaskTime,
        loading: isLoading,
        error: errors,
    };
}
