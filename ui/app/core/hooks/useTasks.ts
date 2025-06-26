import { useState, useEffect } from "react";
import { Task, TaskFormData, FocusStats } from "../../focus/types";

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);

  // Load tasks from localStorage on component mount
  useEffect(() => {
    const savedTasks = localStorage.getItem('focus-tasks');
    if (savedTasks) {
      setTasks(JSON.parse(savedTasks));
    }
  }, []);

  // Save tasks to localStorage whenever tasks change
  useEffect(() => {
    localStorage.setItem('focus-tasks', JSON.stringify(tasks));
  }, [tasks]);

  const addTask = (taskData: TaskFormData) => {
    const newTask: Task = {
      id: Date.now().toString(),
      ...taskData,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setTasks([...tasks, newTask]);
  };

  const updateTaskStatus = (taskId: string, status: Task['status']) => {
    setTasks(tasks.map(task =>
      task.id === taskId
        ? { ...task, status, updatedAt: new Date() }
        : task
    ));
  };

  const deleteTask = (taskId: string) => {
    setTasks(tasks.filter(task => task.id !== taskId));
  };

  const updateTask = (taskId: string, updatedTask: Partial<Task>) => {
    setTasks(tasks.map(task =>
      task.id === taskId
        ? { ...task, ...updatedTask, updatedAt: new Date() }
        : task
    ));
  };

  const updateTaskTime = (taskId: string, completedTime: number) => {
    setTasks(tasks.map(task =>
      task.id === taskId
        ? { ...task, completedTime, updatedAt: new Date() }
        : task
    ));
  };

  const reorderTasks = (fromIndex: number, toIndex: number) => {
    const newTasks = [...tasks];
    const [movedTask] = newTasks.splice(fromIndex, 1);
    newTasks.splice(toIndex, 0, movedTask);
    setTasks(newTasks);
  };

  // Only show pending and in-progress tasks
  const activeTasks = tasks.filter(task => 
    task.status === 'pending' || task.status === 'in-progress'
  );

  // Reorder only active tasks in the main tasks array
  const reorderActiveTasks = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const active = [...activeTasks];
    const [moved] = active.splice(fromIndex, 1);
    active.splice(toIndex, 0, moved);
    // Merge reordered active tasks back into the main tasks array
    let ai = 0;
    const newTasks = tasks.map(t => {
      if (t.status === 'pending' || t.status === 'in-progress') {
        return active[ai++];
      }
      return t;
    });
    setTasks(newTasks);
  };

  const calculateStats = (): FocusStats => {
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(task => task.status === 'completed').length;
    const totalEstimatedTime = tasks.reduce((sum, task) => sum + task.estimatedTime, 0);
    const totalCompletedTime = tasks.reduce((sum, task) => sum + (task.completedTime || 0), 0);
    const averageCompletionTime = completedTasks > 0 ? totalCompletedTime / completedTasks : 0;

    return {
      totalTasks,
      completedTasks,
      totalEstimatedTime,
      totalCompletedTime,
      averageCompletionTime,
    };
  };

  return {
    tasks,
    setTasks,
    addTask,
    updateTaskStatus,
    deleteTask,
    updateTask,
    updateTaskTime,
    reorderTasks,
    reorderActiveTasks,
    activeTasks,
    stats: calculateStats(),
  };
} 