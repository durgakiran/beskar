import { useContext, useEffect, useState } from 'react';
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
