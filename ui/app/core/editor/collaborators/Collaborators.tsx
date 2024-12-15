import { CollaboratorProps } from "@editor/context/collaborators";
import { Avatar } from "flowbite-react";
import { useEffect } from "react";

export interface CollaboratorsProps {
    collaborators: CollaboratorProps[];
}

export default function Collaborators(props: CollaboratorsProps) {

    if (props && props.collaborators && props.collaborators.length > 0) {
        return (
            <div style={{ display: "flex", alignItems: "center" }}>
                {props.collaborators ? props.collaborators.map((collaborator, i) => (
                    <Avatar
                        size={32}
                        img={collaborator.image}
                        alt={collaborator.name}
                        key={i}
                        rounded
                    />
                )) : null}
            </div>
        );
    }

    return <></>;
}
