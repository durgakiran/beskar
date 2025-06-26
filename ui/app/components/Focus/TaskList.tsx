import TaskCard from "./TaskCard";
import TaskAddForm from "./TaskAddForm";
import { Task } from "../../focus/types";

interface TaskListProps {
  tasks: Task[];
  onAdd: (title: string, estimatedTime: number) => void;
  onStatusChange: (taskId: string, status: Task['status']) => void;
  onDelete: (taskId: string) => void;
  onTimeUpdate: (taskId: string, completedTime: number) => void;
  onReorder: (from: number, to: number) => void;
  onTaskClick: (task: Task) => void;
}

export default function TaskList({
  tasks,
  onAdd,
  onStatusChange,
  onDelete,
  onTimeUpdate,
  onReorder,
  onTaskClick,
}: TaskListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="overflow-y-auto pr-1 flex flex-col gap-2 flex-1">
        {tasks.map((task, index) => (
          <TaskCard
            key={task.id}
            task={task}
            index={index}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
            onTimeUpdate={onTimeUpdate}
            onReorder={onReorder}
            onTaskClick={onTaskClick}
            totalTasks={tasks.length}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-2 items-center">
        <TaskAddForm onAdd={onAdd} />
      </div>
    </div>
  );
} 