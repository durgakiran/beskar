"use client";
import { Spinner } from "flowbite-react";
import dynamic from "next/dynamic";
import { ReactNode } from "react";

const LayoutPage = dynamic(() => import("@components/spaceLayout"), {
    ssr: false,
    loading: () => <Spinner />,
});

export default function Layout({ children }: { children: ReactNode }) {
    return <LayoutPage>{children}</LayoutPage>;
}
