export interface Task {
    id: string;
    title: string;
    description: string;
    estimatedTime: number; // in minutes
    completedTime?: number; // in minutes
    status: 'pending' | 'in-progress' | 'completed';
    createdAt: Date;
    updatedAt: Date;
    priority: 'low' | 'medium' | 'high';
}

export interface TaskFormData {
    title: string;
    description: string;
    estimatedTime: number;
    priority: 'low' | 'medium' | 'high';
}

export interface FocusStats {
    totalTasks: number;
    completedTasks: number;
    totalEstimatedTime: number;
    totalCompletedTime: number;
    averageCompletionTime: number;
} 