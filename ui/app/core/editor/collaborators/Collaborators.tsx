import { CollaboratorProps } from "@editor/context/collaborators";
import { Avatar, AvatarStack, Box } from "@primer/react";
import { useEffect } from "react";

export interface CollaboratorsProps {
    collaborators: CollaboratorProps[];
}

export default function Collaborators(props: CollaboratorsProps) {
    useEffect(() => {
        console.log(props);
    }, [props]);

    if (props && props.collaborators && props.collaborators.length > 0) {
        return (
            <Box sx={{ display: "flex", alignItems: "center" }}>
                <AvatarStack>{props.collaborators ? props.collaborators.map((collaborator, i) => <Avatar size={32} src={collaborator.image} alt={collaborator.name} key={i} />) : null}</AvatarStack>
            </Box>
        );
    }

    return <></>;
}
