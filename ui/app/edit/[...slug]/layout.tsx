"use client";
import { Spinner, Flex } from "@radix-ui/themes";
import dynamic from "next/dynamic";
import { ReactNode } from "react";

const LayoutPage = dynamic(() => import("@components/spaceLayout"), {
    ssr: false,
    loading: () => (
        <Flex align="center" justify="center" p="4">
            <Spinner size="3" />
        </Flex>
    ),
});

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <LayoutPage>
            <div className="h-full min-h-0 overflow-y-auto">
                {children}
            </div>
        </LayoutPage>
    );
}
