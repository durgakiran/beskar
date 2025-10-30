import { Button, Dialog, TextField, Select, Flex, Text } from "@radix-ui/themes";
import { FormEvent, useState } from "react";

export default function InviteUser({ open, setOpen, handleInvite }: { open: boolean; setOpen: (open: boolean) => void; handleInvite: (email: string, role: string) => void }) {
    const [isLoading, setIsLoading] = useState<boolean>(false);


    const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
        ev.preventDefault();
        setIsLoading(true);

        try {
            const formData = new FormData(ev.currentTarget);
            handleInvite(formData.get("email") as string, formData.get("role") as string);
        } catch (error) {
            console.log(error);
        }
    }



    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Content size="2" maxWidth="450px">
                <Dialog.Title>Invite User</Dialog.Title>
                <form onSubmit={onSubmit}>
                    <Flex direction="column" gap="4">
                        <label>
                            <Text as="div" size="2" mb="1" weight="bold">
                                Email
                            </Text>
                            <TextField.Root 
                                type="email" 
                                name="email" 
                                id="email" 
                                placeholder="type email" 
                                required 
                            />
                        </label>
                        <label>
                            <Text as="div" size="2" mb="1" weight="bold">
                                Select roles
                            </Text>
                            <Select.Root name="role" required defaultValue="viewer">
                                <Select.Trigger />
                                <Select.Content>
                                    <Select.Item value="admin">Admin</Select.Item>
                                    <Select.Item value="editor">Editor</Select.Item>
                                    <Select.Item value="commenter">Commenter</Select.Item>
                                    <Select.Item value="viewer">Viewer</Select.Item>
                                </Select.Content>
                            </Select.Root>
                        </label>
                        <Flex gap="3" mt="4" justify="end">
                            <Dialog.Close>
                                <Button variant="soft" color="gray" type="button">
                                    Cancel
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" loading={isLoading}>
                                Invite
                            </Button>
                        </Flex>
                    </Flex>
                </form>
            </Dialog.Content>
        </Dialog.Root>
    )
}
