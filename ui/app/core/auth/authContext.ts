import { createContext } from "react";
import Keycloak from 'keycloak-js';
export const keycloak = new Keycloak({
    clientId: process.env.NEXT_PUBLIC_KC_CLIENT_ID,
    realm: process.env.NEXT_PUBLIC_KC_REALM,
    url: process.env.NEXT_PUBLIC_KC_URL,
});

function refreshToken() {
    keycloak.updateToken(10).then((res) => {
        if (res) {
            localStorage.setItem('access_token', keycloak.token);
            localStorage.setItem('refresh_token', keycloak.refreshToken);
        }
    });
}

keycloak.onTokenExpired = refreshToken;

export const authContext = createContext<Keycloak>(keycloak);
