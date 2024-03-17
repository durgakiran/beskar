"use client"
import Header from "./menuBar";
import KeycloakProvider from "app/core/auth/KeycloakProvider";
import UserProvider from "app/core/auth/UserProvider";
import dynamic from "next/dynamic";

const DynamicKeyCloakProvider = dynamic(() => import("app/core/auth/KeycloakProvider"), {
    ssr: false
});

const DynamicUserProvider = dynamic(() => import("app/core/auth/UserProvider"), {
    ssr: false
});

export default function SpaceLayout({ children }: { children: React.ReactNode }) {
    return (
        <DynamicKeyCloakProvider>
            <DynamicUserProvider>
                <Header />
                <div className="bg-white dark:border-gray-700 dark:bg-gray-800 px-4 pt-16 mx-auto max-w-8xl">
                    {children}
                </div>
            </DynamicUserProvider>
        </DynamicKeyCloakProvider>
    )
}
