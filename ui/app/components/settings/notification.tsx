import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet } from "@http/hooks";
import { Avatar, Button, Flex, Text, Box } from "@radix-ui/themes";

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
            <tr className="border-b">
                <td className="px-4 py-3">
                    <Flex gap="3" align="center">
                        <Avatar 
                            size="3" 
                            fallback={props.senderName.charAt(0).toUpperCase()} 
                            radius="full"
                        />
                        <Box>
                            <Text as="div" size="2" color="gray">
                                <Text weight="bold" color="gray">{props.senderName}</Text>
                                {` invited you to space `}
                                <Text weight="bold" color="gray">{props.name}</Text>
                            </Text>
                            <Text size="1" color="gray" style={{ textTransform: 'capitalize' }}>
                                Space · {props.role}
                            </Text>
                        </Box>
                    </Flex>
                </td>
                <td className="px-4 py-3">
                    <Button 
                        variant="outline" 
                        size="1" 
                        color="gray" 
                        onClick={rejectInvite} 
                        loading={isRejectLoading} 
                        disabled={isLoading || isRejectLoading || !!(response || rejectResponse)}
                    >
                        Reject
                    </Button>
                </td>
                <td className="px-4 py-3">
                    <Button 
                        variant="soft" 
                        size="1" 
                        onClick={acceptInvite} 
                        loading={isLoading} 
                        disabled={isLoading || isRejectLoading || !!(response || rejectResponse)}
                    >
                        Accept
                    </Button>
                </td>
            </tr>
            {data && response === 200 && <ToastComponent icon="Check" type="success" toggle={true} message="Invitation accepted" />}
            {(data || errors) && response != 200 && <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Unable to accept invitation" />}
            {rejectData && rejectResponse === 200 && <ToastComponent icon="Check" type="success" toggle={true} message="Invitation Rejection Success" />}
            {(rejectData || rejectErrors) && rejectResponse != 200 && <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Invitation Rejection Failed" />}
        </>
    );
}
