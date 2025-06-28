import { useDelete } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { useFetchTasks } from "./useFetchTasks";

export function useDeleteTask() {
  const { setError } = useFocusContext();
  const [deleteTaskState, deleteTaskApi] = useDelete<any, { id: string }>("focus/tasks");
  const { fetchTasks } = useFetchTasks();

  const deleteTask = (taskId: string) => {
    deleteTaskApi({ id: taskId });
    setTimeout(() => fetchTasks(), 500);
  };

  if (deleteTaskState.errors) {
    setError("Failed to delete task");
  }

  return {
    deleteTask,
    loading: deleteTaskState.isLoading,
    error: deleteTaskState.errors,
  };
} 