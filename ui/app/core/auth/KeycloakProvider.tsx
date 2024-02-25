"use client"
import { useEffect, useRef } from 'react';
import useKeycloak from './useKeycloak';


export default function KeycloakProvider ({ children }: { children: React.ReactNode }) {
    const keycloakInitialized = useRef(false);
    const keycloak = useKeycloak();

    useEffect(() => {
        if (!keycloakInitialized.current) {
            keycloakInitialized.current = true;
            keycloak
                .init({
                    onLoad: "login-required",
                    checkLoginIframe: false
                })
                .then((res) =>{
                    if (res) {
                        console.log(keycloak.token);
                        localStorage.setItem('access_token', keycloak.token);
                    }
                })
                .catch((e) => console.error(e));
        }
    }, []);
    return <>{children}</>
};