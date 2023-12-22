"use client"
import Login from "@components/login"
import { SessionProvider } from "next-auth/react"


export default function Page() {
    return (
        <SessionProvider>
            <Login />
            <h1>Hello, Ted Dox!</h1>
        </SessionProvider>
    )
}
