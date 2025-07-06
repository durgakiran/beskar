import { usePUT } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task } from "../types";
import { useFetchTasks } from "./useFetchTasks";
import { useEffect, useRef } from "react";

export function useUpdateTaskStatus() {
    const { setError } = useFocusContext();
    const [{ isLoading, data, errors }, putStatus] = usePUT<Task, { status: Task["status"] }>("focus/tasks");
    const { fetchTasks } = useFetchTasks();
    const wasLoadingRef = useRef(false);

    const updateTaskStatus = (taskId: string, status: Task["status"]) => {
        putStatus({ status }, `focus/tasks/${taskId}/status`);
    };

    // Trigger fetchTasks when loading changes from true to false (operation completes)
    useEffect(() => {
        if (wasLoadingRef.current && !isLoading) {
            fetchTasks();
        }
        wasLoadingRef.current = isLoading;
    }, [isLoading, fetchTasks]);

    if (errors) {
        setError("Failed to update task status");
    }

    return {
        updateTaskStatus,
        loading: isLoading,
        error: errors,
    };
}
