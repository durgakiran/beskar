"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { InlineEditableProps } from "./types";
import { FiCheck } from "react-icons/fi";
import { Spinner } from "@radix-ui/themes";

export function InlineEditable({
    value,
    onSave,
    placeholder = "Click to edit...",
    multiline = false,
    canEdit = true,
    isLoading = false,
    className,
    textClassName,
    inputClassName,
}: InlineEditableProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const [showSaved, setShowSaved] = useState(false);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    // Sync with external value when not editing
    useEffect(() => {
        if (!isEditing) {
            setLocalValue(value);
        }
    }, [value]);

    // Autosave Debounce
    useEffect(() => {
        if (!isEditing || localValue === value) return;

        const timer = setTimeout(() => {
            onSave(localValue);
            setShowSaved(true);
            setTimeout(() => setShowSaved(false), 2000);
        }, 1000);

        return () => clearTimeout(timer);
    }, [localValue, onSave, isEditing, value]);

    // Focus handling
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            // Move cursor to end
            if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
                inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
            }
        }
    }, [isEditing]);

    const handleBlur = () => {
        if (localValue !== value) {
            onSave(localValue);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !multiline) {
            inputRef.current?.blur();
        }
        if (e.key === "Escape") {
            setLocalValue(value);
            setIsEditing(false);
        }
    };

    if (!canEdit) {
        return (
            <div className={cn("group relative", className)}>
                <div className={cn("break-words", textClassName)}>
                    {value || <span className="italic text-neutral-400">{placeholder}</span>}
                </div>
            </div>
        );
    }

    return (
        <div className={cn("group relative w-full", className)}>
            {isEditing ? (
                <div className="relative w-full">
                    {multiline ? (
                        <textarea
                            ref={inputRef as any}
                            value={localValue}
                            onChange={(e) => setLocalValue(e.target.value)}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            placeholder={placeholder}
                            className={cn(
                                "w-full resize-none rounded-lg border border-primary-500 bg-white p-2 text-inherit focus:outline-none focus:ring-2 focus:ring-primary-100",
                                inputClassName
                            )}
                            rows={3}
                        />
                    ) : (
                        <input
                            ref={inputRef as any}
                            type="text"
                            value={localValue}
                            onChange={(e) => setLocalValue(e.target.value)}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            placeholder={placeholder}
                            className={cn(
                                "w-full rounded-lg border border-primary-500 bg-white py-1 px-2 text-inherit focus:outline-none focus:ring-2 focus:ring-primary-100",
                                inputClassName
                            )}
                        />
                    )}
                    
                    {/* Status Indicators */}
                    <div className="absolute right-2 top-2 flex items-center gap-2">
                        {isLoading && <Spinner size="1" />}
                        {showSaved && !isLoading && <FiCheck className="text-green-500 h-4 w-4" />}
                    </div>
                </div>
            ) : (
                <div 
                    onClick={() => setIsEditing(true)}
                    className={cn(
                        "cursor-pointer rounded-lg border border-transparent transition-all",
                        "hover:border-primary-200 hover:bg-primary-50/30",
                        !value && "italic text-neutral-400 font-normal",
                        textClassName
                    )}
                >
                    <div className="flex items-center gap-2">
                        <span className="flex-1 break-words">
                            {value || placeholder}
                        </span>
                        {/* Hidden-until-row-hover indicator suggest editability */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                             {isLoading ? <Spinner size="1" /> : showSaved ? <FiCheck className="text-green-500 h-3 w-3" /> : null}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
