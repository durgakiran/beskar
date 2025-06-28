import { usePUT } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task, TaskOrderItem } from "../types";
import { useFetchTasks } from "./useFetchTasks";
import { useEffect } from "react";

export function useReorderTasks() {
    const { tasks, setTasks, setError } = useFocusContext();
    const [{ isLoading, errors }, putReorder] = usePUT<any, { taskOrders: TaskOrderItem[] }>("focus/tasks");
    const { fetchTasks } = useFetchTasks();

    // Only show pending and in-progress tasks
    const activeTasks = tasks.filter((task) => task.status === "pending" || task.status === "in-progress");

    useEffect(() => {
        if (!isLoading) {
            fetchTasks();
        }
    }, [isLoading]);

    // Reorder tasks using the API
    const reorderActiveTasks = async (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;

        const active = [...activeTasks];
        const [moved] = active.splice(fromIndex, 1);
        active.splice(toIndex, 0, moved);

        // Create task order items for the API
        const taskOrders: TaskOrderItem[] = active.map((task, index) => ({
            taskId: task.id,
            taskOrder: index,
        }));

        try {
            // Call the API to reorder tasks
            putReorder({ taskOrders }, "focus/tasks/reorder");

            // Update local state immediately for better UX
            const newTasks = tasks.map((t) => {
                const activeIndex = active.findIndex((at) => at.id === t.id);
                if (activeIndex !== -1 && (t.status === "pending" || t.status === "in-progress")) {
                    return { ...t, taskOrder: activeIndex };
                }
                return t;
            });

            // Sort by taskOrder
            newTasks.sort((a, b) => a.taskOrder - b.taskOrder);
            setTasks(newTasks);

            // Refresh from server after a short delay to ensure consistency
            // setTimeout(() => fetchTasks(), 1000);
        } catch (error) {
            setError("Failed to reorder tasks");
            // Revert to original order on error
            fetchTasks();
        }
    };

    return {
        activeTasks,
        reorderActiveTasks,
        loading: isLoading,
        error: errors,
    };
}
