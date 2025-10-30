'use client'
import { Response, usePost } from "@http/hooks";
import { Button, Dialog, TextField, Flex, Text } from "@radix-ui/themes";
import { MouseEvent, useCallback, useEffect, useState } from "react";


interface IAddSpace {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
}

interface Payload {
    name: string;
}

interface Data {
    data: string;
}

export default function AddSpace({ isOpen, setIsOpen }: IAddSpace) {
    const [name, setName] = useState('');
    const [{ data, errors: error, isLoading: loading }, mutateData] = usePost<Response<Data>, Payload>("space/create")

    const onDialogClose = useCallback(() => {
        setIsOpen(false);
    }, []);

    const handleInput = useCallback((value: string) => {
        setName(value);
    }, []);

    const handleSubmit = async (ev: MouseEvent<HTMLButtonElement>) => {
        ev.preventDefault();
        await mutateData({ name: name });
    };

    useEffect(() => {
        if (data && !loading) {
            setIsOpen(false);
        }
    }, [data, loading])

    return (
        <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
            <Dialog.Content size="2" maxWidth="450px">
                <Dialog.Title>Create new space</Dialog.Title>
                <Flex direction="column" gap="4">
                    <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                            Space name
                        </Text>
                        <TextField.Root
                            id="name"
                            placeholder="Engineering"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            required
                        />
                    </label>
                    <Flex gap="3" mt="4" justify="end">
                        <Dialog.Close>
                            <Button variant="soft" color="gray">
                                Cancel
                            </Button>
                        </Dialog.Close>
                        <Button onClick={handleSubmit} loading={loading} disabled={loading}>
                            Create
                        </Button>
                    </Flex>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    )
}
