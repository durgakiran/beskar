"use client"
import MenuBar from "@components/menuBar";
import { Box, Flex } from "@radix-ui/themes";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Layout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isNotifications = pathname === "/user/notifications";
    
    return (
        <div>
            <MenuBar />
            <Box className="px-4 pt-16 mx-auto max-w-8xl">
                <Flex gap="4">
                    <Box className="w-64 border-r border-gray-200" p="4">
                        <Flex direction="column" gap="2">
                            <Link 
                                href="/user/notifications"
                                className={`px-3 py-2 rounded text-sm ${isNotifications ? 'bg-plum-100 text-plum-900 font-medium' : 'hover:bg-gray-100'}`}
                            >
                                Notifications
                            </Link>
                            <Link 
                                href="#"
                                className="px-3 py-2 rounded text-sm hover:bg-gray-100"
                            >
                                Profile
                            </Link>
                            <Link 
                                href="#"
                                className="px-3 py-2 rounded text-sm hover:bg-gray-100"
                            >
                                Settings
                            </Link>
                        </Flex>
                    </Box>
                    <Box style={{ flex: 1 }}>{children}</Box>
                </Flex>
            </Box>
        </div>
    );
}