"use client";
import { Spinner, Flex } from "@radix-ui/themes";
import React, { Suspense, lazy } from "react";
import { ReactNode } from "react";

const LayoutPageLoader = lazy(() => import("@components/spaceLayout"));
const LayoutPage = (props: any) => (
    <Suspense fallback={
        <Flex align="center" justify="center" p="4">
            <Spinner size="3" />
        </Flex>
    }>
        <LayoutPageLoader {...props} />
    </Suspense>
);

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <LayoutPage>
            <div className="h-full min-h-0 overflow-y-auto">
                {children}
            </div>
        </LayoutPage>
    );
}
