"use client";
import { FocusStats as FocusStatsType } from "../types";

interface FocusStatsProps {
    stats: FocusStatsType;
}

export default function FocusStats({ stats }: FocusStatsProps) {
    const formatTime = (minutes: number) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        return `${mins}m`;
    };

    const completionRate = stats.totalTasks > 0 
        ? Math.round((stats.completedTasks / stats.totalTasks) * 100) 
        : 0;

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-center p-2 bg-blue-50 rounded">
                    <div className="font-medium text-blue-700">{stats.totalTasks}</div>
                    <div className="text-blue-600">Total Tasks</div>
                </div>
                
                <div className="text-center p-2 bg-green-50 rounded">
                    <div className="font-medium text-green-700">{stats.completedTasks}</div>
                    <div className="text-green-600">Completed</div>
                </div>
                
                <div className="text-center p-2 bg-purple-50 rounded">
                    <div className="font-medium text-purple-700">{completionRate}%</div>
                    <div className="text-purple-600">Success Rate</div>
                </div>
                
                <div className="text-center p-2 bg-orange-50 rounded">
                    <div className="font-medium text-orange-700">{formatTime(stats.totalEstimatedTime)}</div>
                    <div className="text-orange-600">Estimated</div>
                </div>
            </div>
            
            <div className="text-center p-2 bg-gray-50 rounded">
                <div className="text-xs text-gray-600 mb-1">Time Tracking</div>
                <div className="font-medium text-gray-900">{formatTime(stats.totalCompletedTime)}</div>
                <div className="text-xs text-gray-500">Total time spent</div>
            </div>
        </div>
    );
} 