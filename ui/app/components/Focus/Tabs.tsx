import React from "react";

interface TabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabList = [
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Quick Notes" },
  { id: "settings", label: "Settings" },
];

export default function Tabs({ activeTab, onTabChange }: TabsProps) {
  return (
    <div className="flex border-b border-gray-200">
      {tabList.map(tab => (
        <button
          key={tab.id}
          className={`px-4 py-2 text-sm font-medium focus:outline-none transition-colors ${
            activeTab === tab.id
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-500 hover:text-blue-600"
          }`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
} 