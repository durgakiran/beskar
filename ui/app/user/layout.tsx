"use client"
import MenuBar from "@components/menuBar";
import { Sidebar } from "flowbite-react";

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <MenuBar />
            <div className="bg-white dark:border-gray-700 dark:bg-gray-800 px-4 pt-16 mx-auto max-w-8xl">
                <div className="flex flex-row gap-4">
                    <Sidebar aria-label="User settings navigation">
                        <Sidebar.Items>
                            <Sidebar.ItemGroup>
                                <Sidebar.Item active href="/user/notifications">
                                    Notifications
                                </Sidebar.Item>
                                <Sidebar.Item href="#">
                                    Profile
                                </Sidebar.Item>
                                <Sidebar.Item href="#">
                                    Settings
                                </Sidebar.Item>
                            </Sidebar.ItemGroup>
                        </Sidebar.Items>
                    </Sidebar>
                    <div>{children}</div>
                </div>
            </div>
        </div>
    );
}