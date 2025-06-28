"use client";
import React, { createContext, useContext, useState, ReactNode, useMemo } from 'react';
import { Task, FocusStats } from '../../focus/types';

interface FocusContextType {
  tasks: Task[];
  stats: FocusStats;
  loading: boolean;
  error: string | null;
  setTasks: (tasks: Task[]) => void;
  setStats: (stats: FocusStats) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const FocusContext = createContext<FocusContextType | undefined>(undefined);

export function FocusProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasksState] = useState<Task[]>([]);
  const [stats, setStats] = useState<FocusStats>({
    totalTasks: 0,
    completedTasks: 0,
    totalEstimatedTime: 0,
    totalCompletedTime: 0,
    averageCompletionTime: 0,
    totalSessions: 0,
    totalSessionTime: 0,
    productivityScore: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wrapper function
  const setTasks = (newTasks: Task[]) => {
    setTasksState(newTasks);
  };

  const value = useMemo(() => ({
    tasks,
    stats,
    loading,
    error,
    setTasks,
    setStats,
    setLoading,
    setError,
  }), [tasks, stats, loading, error]);

  return (
    <FocusContext.Provider value={value}>
      {children}
    </FocusContext.Provider>
  );
}

export function useFocusContext() {
  const context = useContext(FocusContext);
  if (context === undefined) {
    throw new Error('useFocusContext must be used within a FocusProvider');
  }
  return context;
} 