import useKeycloak, { useUser } from "app/core/auth/useKeycloak";
import { useRouter } from "next/navigation";
import { useEffect } from "react"

export default function Home() {
    const user = useUser();
    const router = useRouter();

    useEffect(() => {
        if (user && user.authenticated) {
            router.push('/space');
        }
        if (user && !user.authenticated) {
            router.push("/");
        }
    }, [user]);

    return (
        <h2>Welcome to Ted Dox!</h2>
    )
}
