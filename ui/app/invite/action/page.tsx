import InviteActionPage from "@components/invite/InviteActionPage";
import { Flex, Spinner } from "@radix-ui/themes";
import { Suspense } from "react";

export default function Page() {
    return (
        <Suspense
            fallback={
                <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
                    <Spinner size="3" />
                </Flex>
            }
        >
            <InviteActionPage />
        </Suspense>
    );
}
