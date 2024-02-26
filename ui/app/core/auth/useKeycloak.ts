import { useContext, useEffect, useState } from 'react';
import { authContext } from './authContext';



export default function useKeycloak() {
    const keycloak = useContext(authContext);


    return keycloak;
}

export function useAuthenticated() {
    const keycloak = useContext(authContext);
    const [authenticated, setAuthenticated] = useState(false);

    useEffect(() => {
        keycloak.onAuthSuccess = () => {
            setAuthenticated(true);
        };
    }, [keycloak]);

    return authenticated;
}
