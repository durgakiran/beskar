"use client";
import { useGetCall } from "@http";
import { useLogout } from "app/core/auth/useKeycloak";
import { useEffect } from "react";
import { Avatar, Dropdown, Navbar } from 'flowbite-react';
import Link from "next/link";

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
}

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

export default function MenuBar() {
    const [status, res] = useGetCall<UserInfo>(USER_URI + "/profile/details");
    const logout = useLogout();

    useEffect(() => {
        console.log(res);
    }, [res])

    return (
        <Navbar fluid rounded className="fixed w-full bg-white z-50 shadow-sm">
            <Navbar.Brand href="https://flowbite-react.com">
                <span className="self-center whitespace-nowrap text-xl font-semibold dark:text-white">TedDox!</span>
            </Navbar.Brand>
            <div className="flex items-center space-x-4">
                <Navbar.Collapse>
                    <Navbar.Link href="/space" as={Link}>
                        Spaces
                    </Navbar.Link>
                    <Navbar.Link href="#">Pricing</Navbar.Link>
                    <Navbar.Link href="#">Contact</Navbar.Link>
                </Navbar.Collapse>
                <div className="flex">
                    <Dropdown
                        arrowIcon={false}
                        inline
                        label={
                            <Avatar alt="User settings" size="sm" placeholderInitials={res && res.data && res.data.name ? res.data.name.charAt(0).toUpperCase() : ""} rounded />
                        }
                    >
                        {
                            res && res.data ?
                                <>
                                    <Dropdown.Header>
                                        <span className="block text-sm">{res.data.name}</span>
                                        <span className="block truncate text-sm font-medium">{res.data.email}</span>
                                    </Dropdown.Header>
                                    <Dropdown.Item>Dashboard</Dropdown.Item>
                                    <Dropdown.Item>Settings</Dropdown.Item>
                                    <Dropdown.Divider />
                                    <Dropdown.Item onClick={() => logout()}>Sign out</Dropdown.Item>
                                </> 
                            : null
                        }
                    </Dropdown>
                    <Navbar.Toggle />
                </div>
            </div>
        </Navbar>
    );
}
