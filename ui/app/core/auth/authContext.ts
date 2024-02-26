import { createContext } from "react";
import Keycloak from 'keycloak-js';
const keycloak = new Keycloak({
    clientId: process.env.NEXT_PUBLIC_KC_CLIENT_ID,
    realm: process.env.NEXT_PUBLIC_KC_REALM,
    url: process.env.NEXT_PUBLIC_KC_URL,
});
export const authContext = createContext<Keycloak>(keycloak);
