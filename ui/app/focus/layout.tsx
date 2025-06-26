"use client";
import MenuBar from "@components/menuBar";

export default function FocusLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <MenuBar />
            <div className="bg-white dark:border-gray-700 dark:bg-gray-800 px-4 pt-16 mx-auto max-w-7xl">
                <div className="py-6">
                    {children}
                </div>
            </div>
        </div>
    );
} 