import { Button, Table } from "flowbite-react";
import User from "./User";
import { Icon } from "@components/ui/Icon";
import { useDelete } from "app/core/http/hooks/useDelete";
import { useEffect } from "react";

interface Invite {
    entity: string;
    entityId: string;
    email: string;
    role: string;
    senderId: string;
}
export default function InvitedUserRow({ user, refresh }: { user: Invite; refresh: () => void }) {
    const [{ data: deletedData, errors: deleteErrors, isLoading: deleting }, deleteInvite] = useDelete<string, Invite>(`invite/user/remove`);

    useEffect(() => {
        if (deletedData && !deleting) {
            refresh();
        }
    }, [deletedData]);

    useEffect(() => {
        if (deleteErrors && !deleting) {
            // show toast
        }
    }, [deleteErrors]);

    const removeInvitation = (invite: Invite) => {
        deleteInvite({ entity: invite.entity, entityId: invite.entityId, email: invite.email, role: invite.role, senderId: invite.senderId });
    };

    return (
        <Table.Row key={user.email} className="bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
                <div className="flex">
                    <User key={user.email} id={user.email} name={user.email} role={user.role} />
                </div>
            </Table.Cell>
            <Table.Cell>{user.role}</Table.Cell>
            <Table.Cell>
                <Button onClick={() => removeInvitation(user)} disabled={deleting} isProcessing={deleting} outline color="red" size={"xs"}>
                    <Icon className="color-red" name="BadgeX" />
                </Button>
            </Table.Cell>
        </Table.Row>
    );
}
