export interface Task {
    id: string;
    userId: string;
    title: string;
    description: string;
    estimatedTime: number; // in minutes
    totalCompletedTime: number; // in minutes (renamed from completedTime)
    status: 'pending' | 'in-progress' | 'completed';
    priority: 'low' | 'medium' | 'high';
    taskOrder: number; // order of the task in the list
    createdAt: string; // ISO date string from API
    updatedAt: string; // ISO date string from API
    deletedAt?: string; // ISO date string from API
}

export interface TaskFormData {
    title: string;
    description: string;
    estimatedTime: number;
    priority: 'low' | 'medium' | 'high';
}

export interface TaskOrderItem {
    taskId: string;
    taskOrder: number;
}

export interface ReorderTasksRequest {
    taskOrders: TaskOrderItem[];
}

// Session Types
export interface Session {
    id: string;
    userId: string;
    sessionType: 'pomodoro' | 'break' | 'long_break';
    duration: number; // in minutes
    actualDuration?: number; // in minutes
    startedAt: string; // ISO date string
    endedAt?: string; // ISO date string
    status: 'active' | 'completed' | 'interrupted';
    notes?: string;
}

export interface SessionTask {
    id: string;
    sessionId: string;
    taskId: string;
    timeSpent: number; // in minutes
    startedAt: string; // ISO date string
    endedAt?: string; // ISO date string
    status: 'active' | 'completed' | 'paused';
    notes?: string;
    taskTitle: string;
    taskDescription: string;
    taskPriority: string;
}

// Session Request/Response Types
export interface CreateSessionRequest {
    sessionType: 'pomodoro' | 'break' | 'long_break';
    duration: number; // in minutes
    notes?: string;
}

export interface EndSessionRequest {
    actualDuration: number; // in minutes
    status: 'completed' | 'interrupted';
}

export interface AddTaskToSessionRequest {
    taskId: string;
    timeSpent: number; // in minutes
    notes?: string;
}

export interface UpdateSessionTaskRequest {
    timeSpent: number; // in minutes
    status: 'active' | 'completed' | 'paused';
}

export interface SessionListResponse {
    sessions: Session[];
    total: number;
    limit: number;
    offset: number;
}

export interface FocusStats {
    totalTasks: number;
    completedTasks: number;
    totalEstimatedTime: number;
    totalCompletedTime: number;
    averageCompletionTime: number;
    totalSessions: number;
    totalSessionTime: number;
    productivityScore: number;
} 