import SpaceLayout from "@components/spaceLayout";
import { Box, Flex } from "@radix-ui/themes";
import { Link } from "react-router-dom";
import { useLocation, Outlet } from "react-router-dom";

export default function UserLayout() {
    const pathname = useLocation().pathname;
    const isNotifications = pathname === "/user/notifications";
    const isStorage = pathname === "/user/storage";

    if (isNotifications) {
        return (
            <SpaceLayout>
                <Box className="mx-auto max-w-6xl px-4 py-6"><Outlet /></Box>
            </SpaceLayout>
        );
    }

    return (
        <SpaceLayout>
            <Box className="mx-auto max-w-8xl px-4 py-6">
                <Flex gap="4" direction={{ initial: "column", md: "row" }}>
                    <Box className="shrink-0 border-neutral-200 md:w-56 md:border-r" p="4">
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
                    <Box className="min-w-0 flex-1 md:p-4">
                        <Outlet />
                    </Box>
                </Flex>
            </Box>
        </SpaceLayout>
    );
}
