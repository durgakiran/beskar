"use client"
import { useEffect, useRef, useState } from 'react';
import useKeycloak, { useUser } from './useKeycloak';
import { IUserContext, UserContext } from './userContext';


export default function UserProvider ({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<IUserContext>({ authenticated: true, loading: true });
    const keycloak = useKeycloak();

    useEffect(() => {
        if (keycloak.authenticated) {
            setUser({ authenticated: true, loading: false });
        }
        keycloak.onAuthSuccess = () => {
            setUser({ authenticated: true, loading: false });
        };
        keycloak.onAuthError = () => {
            setUser({ authenticated: false, loading: false });
        };
    }, [keycloak]);


    return (
        <UserContext.Provider value={user}>
            {children}
        </UserContext.Provider>
    )
};
