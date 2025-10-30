"use client"
import { useGetCall } from "@http";
import { Avatar, DropdownMenu, Flex, Box, Text, IconButton, Tooltip, Button, Link } from "@radix-ui/themes";
// import Link from "next/link";
import ModifiedIcon from "./modifiedIcon";

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
}

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

export default function MenuBar() {
    const [status, res] = useGetCall<UserInfo>(USER_URI + "/profile/details");

    const handleLogout = () => {
        window.location.href = "/auth/logout";
    }

    return (
        <Box className="fixed w-full bg-white z-50 shadow-sm border-b border-neutral-200" py="3" px="4">
            <Flex align="center" justify="between">
                <Link href="/" className="hover:opacity-80 transition-opacity">
                    <Text size="5" weight="bold" className="text-primary-700">TedEDox</Text>
                </Link>
                <Flex align="center" gap="6">
                    <Flex align="center" gap="5">
                        <Link 
                            href="/space" 
                            underline="hover"
                            className="text-neutral-700 hover:text-primary-700 font-medium transition-colors"
                        >
                            Spaces
                        </Link>
                        <Link 
                            href="#" 
                            underline="hover"
                            className="text-neutral-700 hover:text-primary-700 font-medium transition-colors"
                        >
                            Contact
                        </Link>
                    </Flex>
                    <Flex align="center" gap="3">
                        <Tooltip content="Notifications">
                            <IconButton 
                                variant="ghost" 
                                asChild
                                className="text-mauve-600 hover:text-primary-600 hover:bg-mauve-50"
                            >
                                <a
                                    rel="noopener"
                                    href="/user/notifications"
                                    aria-label="Notifications"
                                >
                                    <ModifiedIcon name="Bell" size={16} />
                                </a>
                            </IconButton>
                        </Tooltip>
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger>
                                <IconButton 
                                    variant="surface" 
                                    radius="full" 
                                    highContrast
                                    className="hover:bg-mauve-50"
                                >
                                    <Avatar
                                        size="2"
                                        fallback={res && res.data && res.data.name ? res.data.name.charAt(0).toUpperCase() : "U"}
                                        className="ring-2 ring-mauve-200"
                                        style={{ cursor: "pointer" }}
                                    />
                                </IconButton>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content className="bg-white border border-neutral-200 shadow-lg rounded-sm">
                                {res && res.data ? (
                                    <>
                                        <Box px="2" py="2" className="border-b border-neutral-100">
                                            <Text size="2" weight="bold" as="div" className="text-neutral-900">{res.data.name}</Text>
                                            <Text size="1" as="div" className="text-neutral-500">{res.data.email}</Text>
                                        </Box>
                                        <DropdownMenu.Separator className="bg-neutral-200" />
                                        <DropdownMenu.Item className="hover:bg-mauve-50 text-neutral-700">Dashboard</DropdownMenu.Item>
                                        <DropdownMenu.Item className="hover:bg-mauve-50 text-neutral-700">Settings</DropdownMenu.Item>
                                        <DropdownMenu.Separator className="bg-neutral-200" />
                                        <DropdownMenu.Item 
                                            onClick={() => handleLogout()}
                                            className="hover:bg-error-50 text-error-600"
                                        >
                                            Sign out
                                        </DropdownMenu.Item>
                                    </>
                                ) : null}
                            </DropdownMenu.Content>
                        </DropdownMenu.Root>
                    </Flex>
                </Flex>
            </Flex>
        </Box>
    );
}
