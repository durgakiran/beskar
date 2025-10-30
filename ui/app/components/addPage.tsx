"use client";
import { MouseEvent, useCallback, useEffect, useState } from "react";
import { Dialog, Button, TextField, Flex, Text } from "@radix-ui/themes";
import { Response, usePost } from "@http/hooks";

interface IAddPage {
    isOpen: boolean;
    spaceId: string;
    parentId?: number;
    setIsOpen: (open: boolean) => void;
    editPage: (pageId: number) => void;
}

interface Page {
    spaceId: string;
    title: string;
    parentId?: number;
}

interface PageResponse {
    page: number;
}

export default function AddPage({ isOpen, setIsOpen, spaceId, parentId, editPage }: IAddPage) {
    const [name, setName] = useState("");
    const [{ data, errors, isLoading: loading }, createPage] = usePost<Response<PageResponse>, Page>(`editor/space/${spaceId}/page/create`);
    const [added, setAdded] = useState(false);

    const handleInput = useCallback((value: string) => {
        setName(value);
    }, []);

    const handleSubmit = async (ev: MouseEvent<HTMLButtonElement>) => {
        ev.preventDefault();
        await createPage({ title: name, spaceId, parentId: parentId });
    };
    const closeModal = () => {
        setIsOpen(false);
    };

    useEffect(() => {
        if (data) {
            setAdded(true);
            editPage(data.data.page);
        }
    }, [data]);

    return (
        <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
            <Dialog.Content size="2" maxWidth="450px">
                <Dialog.Title>Add a new Page</Dialog.Title>
                <Flex direction="column" gap="4">
                    <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                            Title of Page
                        </Text>
                        <TextField.Root
                            value={name}
                            onChange={(ev) => handleInput(ev.target.value)}
                            placeholder="Enter page title..."
                        />
                    </label>
                    <Flex gap="3" mt="4" justify="end">
                        <Dialog.Close>
                            <Button variant="soft" color="gray">
                                Cancel
                            </Button>
                        </Dialog.Close>
                        <Button onClick={handleSubmit} disabled={loading || added} loading={loading}>
                            Add
                        </Button>
                    </Flex>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
