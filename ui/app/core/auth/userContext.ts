import { createContext } from "react";

export interface IUserContext {
    authenticated: boolean;
    loading: boolean;
}

export const UserContext = createContext<IUserContext>(null);

