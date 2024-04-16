import { useCallback, useContext } from "react";
import { authContext } from "./authContext";
import { UserContext } from "./userContext";
import { signOut } from "next-auth/react";

export default function useKeycloak() {
    const keycloak = useContext(authContext);

    return keycloak;
}

export function useUser() {
    const user = useContext(UserContext);

    return user;
}

export function useLogout() {
    const callbackFn = useCallback(async () => {
        try {
            const response = await fetch("/api/auth/federated-logout");
            const data = await response.json();
            if (response.ok) {
                await signOut({ redirect: false });
                window.location.href = data.url;
                return;
            }
            throw new Error(data.error);
        } catch (error) {
            console.log(error);
            alert(error);
            await signOut({ redirect: false });
            window.location.href = "/";
        }
    }, []);

    return callbackFn;
}
