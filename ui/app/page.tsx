"use client";
import KeycloakProvider from "./core/auth/KeycloakProvider";
import Home from "@components/home";


export default function Page() {
    return (
        <KeycloakProvider>
            <Home />
        </KeycloakProvider>
    );
}
