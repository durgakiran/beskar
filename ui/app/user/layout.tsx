import MenuBar from "@components/menuBar";
import { Box, Flex } from "@radix-ui/themes";
import { Link } from "react-router-dom";
import { useLocation, Outlet } from "react-router-dom";

export default function UserLayout() {
    const pathname = useLocation().pathname;
    const isNotifications = pathname === "/user/notifications";
    const isStorage = pathname === "/user/storage";

    if (isNotifications) {
        return (
            <div>
                <MenuBar />
                <Box className="px-4 pt-16 pb-8 mx-auto max-w-6xl"><Outlet /></Box>
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
                                to="/user/notifications"
                                className={`px-3 py-2 rounded text-sm ${isNotifications ? "bg-primary-100 text-primary-900 font-medium" : "hover:bg-neutral-100 text-neutral-700"}`}
                            >
                                Notifications
                            </Link>
                            <Link to="/user/storage" className={`px-3 py-2 rounded text-sm ${isStorage ? "bg-primary-100 text-primary-900 font-medium" : "hover:bg-neutral-100 text-neutral-700"}`}>
                                Storage &amp; Limits
                            </Link>
                        </Flex>
                    </Box>
                    <Box className="flex-1 p-4">
                        <Outlet />
                    </Box>
                </Flex>
            </Box>
        </div>
    );
}
