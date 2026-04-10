"use client"
import MenuBar from "@components/menuBar";
import { Box, Flex } from "@radix-ui/themes";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Layout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isNotifications = pathname === "/user/notifications";

    if (isNotifications) {
        return (
            <div>
                <MenuBar />
                <Box className="px-4 pt-16 pb-8 mx-auto max-w-6xl">
                    {children}
                </Box>
            </div>
        );
    }
    
    return (
        <div>
            <MenuBar />
            <Box className="px-4 pt-16 mx-auto max-w-8xl">
                <Flex gap="4">
                    <Box className="w-64 border-r border-neutral-200" p="4">
                        <Flex direction="column" gap="2">
                            <Link 
                                href="/user/notifications"
                                className={`px-3 py-2 rounded text-sm ${isNotifications ? 'bg-primary-100 text-primary-900 font-medium' : 'hover:bg-neutral-100 text-neutral-700'}`}
                            >
                                Notifications
                            </Link>
                            <Link 
                                href="#"
                                className="px-3 py-2 rounded text-sm hover:bg-neutral-100 text-neutral-700"
                            >
                                Profile
                            </Link>
                            <Link 
                                href="#"
                                className="px-3 py-2 rounded text-sm hover:bg-neutral-100 text-neutral-700"
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
