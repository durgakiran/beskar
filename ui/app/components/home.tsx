import useKeycloak, { useAuthenticated } from "app/core/auth/useKeycloak";
import { useRouter } from "next/navigation";
import { useEffect } from "react"

export default function Home() {
    const authenticated = useAuthenticated();
    const router = useRouter();

    useEffect(() => {
        if (authenticated) {
            router.push('/space');
        }
    }, [authenticated]);

    return (
        <h2>Welcome to Ted Dox!</h2>
    )
}