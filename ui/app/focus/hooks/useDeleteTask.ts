import { useDelete } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { useFetchTasks } from "./useFetchTasks";
import { useEffect, useRef } from "react";

export function useDeleteTask() {
  const { setError } = useFocusContext();
  const [{ isLoading, data, errors }, deleteTaskApi] = useDelete<any, { id: string }>("focus/tasks");
  const { fetchTasks } = useFetchTasks();
  const wasLoadingRef = useRef(false);

  const deleteTask = (taskId: string) => {
    deleteTaskApi({ id: taskId });
  };

  // Trigger fetchTasks when loading changes from true to false (operation completes)
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      fetchTasks();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, fetchTasks]);

  if (errors) {
    setError("Failed to delete task");
  }

  return {
    deleteTask,
    loading: isLoading,
    error: errors,
  };
} 