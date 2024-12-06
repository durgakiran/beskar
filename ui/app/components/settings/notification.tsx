import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet } from "@http/hooks";
import { Avatar, Button, Table } from "flowbite-react";
import { useEffect } from "react";

interface props {
    entityId: string;
    senderName: string;
    name: string;
    role: string;
    token: string;
}

export default function Notification(props: props) {
    const [{ isLoading, data, errors, response }, acceptInvitation] = useGet<Response<any>>("invite/user/accept");
    const [{ isLoading: isRejectLoading, data: rejectData, errors: rejectErrors, response: rejectResponse }, rejectInvitation] = useGet<Response<any>>("invite/user/reject");

    const acceptInvite = () => {
        acceptInvitation({ token: props.token });
    };

    const rejectInvite = () => {
        rejectInvitation({ token: props.token });
    };

    return (
        <>
            <Table.Row key={props.entityId} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
                    <div className="flex">
                        <Avatar placeholderInitials={props.senderName.charAt(0).toUpperCase()} rounded>
                            <div className="space-y-1 font-medium text-gray-500 dark:text-gray-400">
                                <div>
                                    <b className="text-gray-900 dark:text-white">{props.senderName}</b>
                                    {` invited you to space `}
                                    <b className="text-gray-900 dark:text-white">{props.name}</b>
                                </div>
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 capitalize">Space . {props.role}</div>
                        </Avatar>
                    </div>
                </Table.Cell>
                <Table.Cell className="px-4">
                    <Button outline size={"xs"} color="light" pill onClick={rejectInvite} isProcessing={isRejectLoading} disabled={isLoading || isRejectLoading || !!(response || rejectResponse)}>
                        Reject
                    </Button>
                </Table.Cell>
                <Table.Cell className="px-4">
                    <Button outline size={"xs"} color="gray" pill onClick={acceptInvite} isProcessing={isLoading} disabled={isLoading || isRejectLoading || !!(response || rejectResponse)}>
                        Accept
                    </Button>
                </Table.Cell>
            </Table.Row>
            {data && response === 200 && <ToastComponent icon="Check" type="success" toggle={true} message="Invitation accepted" />}
            {(data || errors) && response != 200 && <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Unable to accept invitation" />}
            {rejectData && rejectResponse === 200 && <ToastComponent icon="Check" type="success" toggle={true} message="Invitation Rejection Success" />}
            {(rejectData || rejectErrors) && rejectResponse != 200 && <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Invitation Rejection Failed" />}
        </>
    );
}
