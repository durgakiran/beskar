import { createContext } from "react";

export interface CollaboratorProps {
    image: string;
    name: string;
    id: string;
}

export const CollaboratorsContext = createContext<Array<CollaboratorProps>>(null);
