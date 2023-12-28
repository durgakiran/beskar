'use client'
import { Avatar, Header } from "@primer/react";
import { useSession } from "next-auth/react";


export default function MenuBar() {
    const { data: session } = useSession();


    return (
        <Header sx={{ backgroundColor: 'canvas.subtle'}}>
            <Header.Item sx={{ fontSize: 4, color: 'fg.default', fontWeight: 600 }}>
                <span>Ted Dox!</span>
            </Header.Item>
            <Header.Item full></Header.Item>
            <Header.Item>
                {session && session.user && session.user.image && <Avatar src={session.user.image} size={32} alt={session.user.name} />}
            </Header.Item>
        </Header>
    )
}
