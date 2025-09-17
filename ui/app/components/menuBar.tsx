"use client"
import { useGetCall } from "@http";
import { Avatar, Dropdown, Navbar, Tooltip } from "flowbite-react";
import Link from "next/link";
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
        <Navbar fluid rounded className="fixed w-full bg-white z-50 shadow-sm">
            <Navbar.Brand href="/">
                <span className="self-center whitespace-nowrap text-xl font-semibold dark:text-white">TedEDox!</span>
            </Navbar.Brand>
            <div className="flex items-center space-x-4">
                <Navbar.Collapse>
                    <Navbar.Link href="/space" as={Link}>
                        Spaces
                    </Navbar.Link>
                    {/* <Navbar.Link href="#">Pricing</Navbar.Link> */}
                    <Navbar.Link href="#">Contact</Navbar.Link>
                </Navbar.Collapse>
                <div className="flex items-center gap-4">
                    <Tooltip animation={false} content="Notifications">
                        <a
                            rel="noopener"
                            href="/user/notifications"
                            aria-label="Notifications"
                            className="hidden rounded-lg p-2.5 text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-4 focus:ring-gray-200 lg:block dark:text-gray-300 dark:hover:bg-gray-700 dark:focus:ring-gray-700"
                        >
                            <ModifiedIcon name="Bell" size={16} />
                        </a>
                    </Tooltip>
                    <Dropdown
                        arrowIcon={false}
                        inline
                        label={<Avatar alt="User settings" size="sm" placeholderInitials={res && res.data && res.data.name ? res.data.name.charAt(0).toUpperCase() : ""} rounded />}
                    >
                        {res && res.data ? (
                            <>
                                <Dropdown.Header>
                                    <span className="block text-sm">{res.data.name}</span>
                                    <span className="block truncate text-sm font-medium">{res.data.email}</span>
                                </Dropdown.Header>
                                <Dropdown.Item>Dashboard</Dropdown.Item>
                                <Dropdown.Item>Settings</Dropdown.Item>
                                <Dropdown.Divider />
                                <Dropdown.Item onClick={() => handleLogout()}>Sign out</Dropdown.Item>
                            </>
                        ) : null}
                    </Dropdown>
                    <Navbar.Toggle />
                </div>
            </div>
        </Navbar>
    );
}
