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