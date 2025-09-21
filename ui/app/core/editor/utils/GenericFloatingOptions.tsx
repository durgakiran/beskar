import React from 'react';

interface FloatingOption {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    className?: string;
}

interface GenericFloatingOptionsProps {
    options: FloatingOption[];
}

export function GenericFloatingOptions({ options }: GenericFloatingOptionsProps) {
    return (
        <div className="flex shadow rounded-sm px-2 py-1 z-[9999] items-center gap-2">
            {options.map((option, index) => (
                <button
                    key={index}
                    className={`hover:bg-slate-100 p-1 rounded-sm ${option.className || ''}`}
                    onClick={option.onClick}
                    title={option.label}
                >
                    {option.icon}
                </button>
            ))}
        </div>
    );
}
