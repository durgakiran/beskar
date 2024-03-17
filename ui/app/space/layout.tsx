"use client";
import { Spinner } from "flowbite-react";
import dynamic from "next/dynamic";

const LayoutPage = dynamic(() => import("@components/spaceLayout"), {
    ssr: false,
    loading: () => <Spinner />
})

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <LayoutPage>
            {children}
        </LayoutPage>
    );
}
