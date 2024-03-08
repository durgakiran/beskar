"use client";
import KeycloakProvider from "./core/auth/KeycloakProvider";
import Home from "@components/home";
import UserProvider from "./core/auth/UserProvider";


export default function Page() {
    return (
        <KeycloakProvider>
            <UserProvider>
                <Home />
            </UserProvider>
        </KeycloakProvider>
    );
}
