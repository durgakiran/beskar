import { Box, Flex, Text } from "@radix-ui/themes";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { HiUsers, HiMail } from "react-icons/hi";

export default function SideNav(param: { id: string }) {
    const pathName = usePathname();
    const isUsersActive = pathName.endsWith("users");
    const isInvitesActive = pathName.endsWith("invites");

    return (
        <>
            {/* Desktop Sidebar */}
            <Box className="hidden md:block w-64 h-full bg-neutral-50 border-r border-neutral-200" p="4">
                <Flex direction="column" gap="1">
                    <Text size="1" weight="bold" className="text-neutral-500 uppercase tracking-wide px-2 mb-2">
                        Settings
                    </Text>
                    <Link 
                        href={`/space/${param.id}/settings/users`}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${
                            isUsersActive 
                                ? 'bg-primary-100 text-primary-900' 
                                : 'text-neutral-700 hover:bg-mauve-100 hover:text-primary-700'
                        }`}
                    >
                        <HiUsers size={18} className={isUsersActive ? 'text-primary-600' : 'text-mauve-600'} />
                        <span>Active Users</span>
                    </Link>
                    <Link 
                        href={`/space/${param.id}/settings/invites`}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors ${
                            isInvitesActive 
                                ? 'bg-primary-100 text-primary-900' 
                                : 'text-neutral-700 hover:bg-mauve-100 hover:text-primary-700'
                        }`}
                    >
                        <HiMail size={18} className={isInvitesActive ? 'text-primary-600' : 'text-mauve-600'} />
                        <span>Invited Users</span>
                    </Link>
                </Flex>
            </Box>

            {/* Mobile Navigation */}
            <Box className="md:hidden bg-white border-b border-neutral-200" p="3">
                <Flex gap="2">
                    <Link 
                        href={`/space/${param.id}/settings/users`}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-sm text-sm font-medium transition-colors ${
                            isUsersActive 
                                ? 'bg-primary-500 text-white' 
                                : 'bg-neutral-100 text-neutral-700 hover:bg-mauve-100'
                        }`}
                    >
                        <HiUsers size={16} />
                        <span className="hidden sm:inline">Active</span>
                    </Link>
                    <Link 
                        href={`/space/${param.id}/settings/invites`}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-sm text-sm font-medium transition-colors ${
                            isInvitesActive 
                                ? 'bg-primary-500 text-white' 
                                : 'bg-neutral-100 text-neutral-700 hover:bg-mauve-100'
                        }`}
                    >
                        <HiMail size={16} />
                        <span className="hidden sm:inline">Invited</span>
                    </Link>
                </Flex>
            </Box>
        </>
    );
}

