"use client";
import { Spinner, Flex } from "@radix-ui/themes";
import dynamic from "next/dynamic";

const LayoutPage = dynamic(() => import("@components/spaceLayout"), {
    ssr: false,
    loading: () => (
        <Flex align="center" justify="center" p="4">
            <Spinner size="3" />
        </Flex>
    )
})

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <LayoutPage>
            {children}
        </LayoutPage>
    );
}
