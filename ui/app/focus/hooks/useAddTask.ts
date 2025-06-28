import { usePost } from "@http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task, TaskFormData } from "../types";
import { useFetchTasks } from "./useFetchTasks";
import { useEffect } from "react";

export function useAddTask() {
    const { setError } = useFocusContext();
    const [{ data, errors, isLoading }, postTask] = usePost<Task, TaskFormData>("focus/tasks");
    const { fetchTasks } = useFetchTasks();

    const addTask = (taskData: TaskFormData) => {
        postTask(taskData);
    };

	useEffect(() => {
		if (!isLoading) {
			fetchTasks();
		}
	}, [isLoading]);

    if (errors) {
        setError("Failed to add task");
    }

    return {
        addTask,
        loading: isLoading,
        error: errors,
    };
}
