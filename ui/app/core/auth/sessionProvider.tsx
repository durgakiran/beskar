// src/components/SessionGuard.tsx
import { redirect } from "next/navigation";
import { ReactNode, Suspense } from "react";
import { cookies } from "next/headers";
import { Spinner } from "flowbite-react";

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
    const cookieStore =  cookies();
    
    const res = await authenticted(cookieStore.getAll());
    if (res.status === 401) {
        redirect("/auth/login");
    }


    return (
        <Suspense fallback={<Spinner />}>
            {children}
        </Suspense>
    );
}
