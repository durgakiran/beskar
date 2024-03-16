import { useCallback, useContext } from 'react';
import { authContext } from './authContext';
import { UserContext } from './userContext';



export default function useKeycloak() {
    const keycloak = useContext(authContext);


    return keycloak;
}

export function useUser() {
    const user = useContext(UserContext);

    return user;
}

export function useLogout() {
    const keycloak = useContext(authContext);

    const callbackFn = useCallback(() => {
        keycloak.logout().then(() => {
            localStorage.clear();
        }).catch((err) => {
            console.error("failed to logout", err);
        });
    }, []);

    return callbackFn;
}
