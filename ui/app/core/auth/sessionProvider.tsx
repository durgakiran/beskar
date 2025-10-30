// src/components/SessionGuard.tsx
import { redirect } from "next/navigation";
import { ReactNode, Suspense } from "react";
import { cookies } from "next/headers";
import { Spinner, Flex } from "@radix-ui/themes";

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

const authenticted = async (cookies: {name: string, value: string}[]) => {
    const res = await fetch(`${USER_URI}/authenticated`, {
        method: "GET",
        cache: "no-cache",
        redirect: "follow",
        headers: {
            Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
        }
    });

    return res;
}

export default async function SessionGuard({ children }: { children: ReactNode }) {
    const cookieStore = await cookies();
    
    const res = await authenticted(cookieStore.getAll());
    if (res.status === 401) {
        redirect("/auth/login");
    }


    return (
        <Suspense fallback={
            <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
                <Spinner size="3" />
            </Flex>
        }>
            {children}
        </Suspense>
    );
}
