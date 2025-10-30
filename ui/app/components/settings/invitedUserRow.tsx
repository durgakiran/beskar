import { Button } from "@radix-ui/themes";
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
        <tr className="border-b">
            <td className="px-4 py-3">
                <User key={user.email} id={user.email} name={user.email} role={user.role} />
            </td>
            <td className="px-4 py-3">{user.role}</td>
            <td className="px-4 py-3">
                <Button 
                    onClick={() => removeInvitation(user)} 
                    disabled={deleting} 
                    loading={deleting} 
                    variant="outline" 
                    color="red" 
                    size="1"
                >
                    <Icon className="color-red" name="BadgeX" />
                </Button>
            </td>
        </tr>
    );
}
