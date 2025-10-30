import { CollaboratorProps } from "@editor/context/collaborators";
import { Avatar, Flex } from "@radix-ui/themes";

export interface CollaboratorsProps {
    collaborators: CollaboratorProps[];
}

export default function Collaborators(props: CollaboratorsProps) {

    if (props && props.collaborators && props.collaborators.length > 0) {
        return (
            <Flex align="center" gap="2">
                {props.collaborators ? props.collaborators.map((collaborator, i) => (
                    <Avatar
                        size="2"
                        src={collaborator.image}
                        fallback={collaborator.name?.charAt(0) || "U"}
                        key={i}
                        radius="full"
                    />
                )) : null}
            </Flex>
        );
    }

    return <></>;
}
