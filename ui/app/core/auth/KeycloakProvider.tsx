"use client"
import { useEffect, useRef } from 'react';
import useKeycloak from './useKeycloak';


export default function KeycloakProvider ({ children }: { children: React.ReactNode }) {
    const keycloakInitialized = useRef(false);
    const keycloak = useKeycloak();

    useEffect(() => {
        if (!keycloakInitialized.current && !keycloak.authenticated) {
            console.log("initialising keycloak");
            keycloakInitialized.current = true;
            keycloak
                .init({
                    onLoad: "login-required",
                    checkLoginIframe: false
                })
                .then((res) =>{
                    if (res) {
                        localStorage.setItem('access_token', keycloak.token);
                        localStorage.setItem('refresh_token', keycloak.refreshToken);
                    }
                })
                .catch((e) => console.error(e));
        }
    }, []);
    return <>{children}</>
};
