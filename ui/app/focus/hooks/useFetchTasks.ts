import { useEffect } from "react";
import { useGet } from "../../core/http/hooks";
import { useFocusContext } from "../../core/context/FocusContext";
import { Task } from "../types";

export function useFetchTasks() {
    const { setTasks, setLoading, setError } = useFocusContext();
    const [{ isLoading, data, errors, response }, fetchTasks] = useGet<{ status: string; data: { tasks: Task[] } }>("focus/tasks");

    useEffect(() => {
        setLoading(isLoading);
        if (data && data.data && Array.isArray(data.data.tasks)) {
            setTasks(data.data.tasks);
        }
        if (errors) {
            setError("Failed to load tasks");
        }
    }, [isLoading, data, setTasks, setLoading, setError, errors]);

    return {
        fetchTasks,
        isLoading,
        errors,
        response,
    };
}
