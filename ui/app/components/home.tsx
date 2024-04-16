import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react"

export default function Home() {
    const { data, status } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (status !== "loading" && data) {
            router.push('/space');
        }
        if (status === "unauthenticated") {
            router.push("/");
        }
    }, [data, status]);

    return (
        <h2>Welcome to Ted Dox!</h2>
    )
}
