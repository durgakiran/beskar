"use client";
import { useGetCall } from "@http";
import { Button, Header } from "@primer/react";
import { useLogout } from "app/core/auth/useKeycloak";
import { useEffect } from "react";
import { CustomAvatar } from "./customAvatar";

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
}

export default function MenuBar() {
    const [status, res] = useGetCall<UserInfo>("http://localhost:8084/user/details");
    const logout = useLogout();

    useEffect(() => {
        console.log(res);
    }, [res])

    return (
        <Header sx={{ backgroundColor: "canvas.subtle" }}>
            <Header.Item sx={{ fontSize: 4, color: "fg.default", fontWeight: 600 }}>
                <span>Ted Dox!</span>
            </Header.Item>
            <Header.Item full></Header.Item>
            <Header.Item>
                {res && res.data && res.data.name && <CustomAvatar />}
            </Header.Item>
            <Header.Item>
                <Button variant="invisible" onClick={() => logout()} >Logout</Button>
            </Header.Item>
        </Header>
    );
}
