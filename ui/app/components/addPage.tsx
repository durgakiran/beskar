"use client";
import { MouseEvent, useCallback, useEffect, useState } from "react";
import { Dialog, Button, TextField, Flex, Text, Select } from "@radix-ui/themes";
import { Response, usePost } from "@http/hooks";

interface IAddPage {
    isOpen: boolean;
    spaceId: string;
    parentId?: number;
    setIsOpen: (open: boolean) => void;
    editPage: (pageId: number) => void;
    disabled?: boolean;
    disabledMessage?: string;
}

interface Page {
    spaceId: string;
    title: string;
    parentId?: number;
}

interface PageResponse {
    page: number;
}

export default function AddPage({ isOpen, setIsOpen, spaceId, parentId, editPage, disabled = false, disabledMessage = "This space is archived and read-only." }: IAddPage) {
    const [name, setName] = useState("");
    const [pageType, setPageType] = useState<"document" | "whiteboard">("document");
    const [pendingCreate, setPendingCreate] = useState(false);
    
    const [{ data: docData, isLoading: docLoading, errors: docErrors }, createDoc] = usePost<Response<PageResponse>, Page>(`editor/space/${spaceId}/page/create`);
    const [{ data: wbData, isLoading: wbLoading, errors: wbErrors }, createWb] = usePost<Response<PageResponse>, Page>(`editor/space/${spaceId}/whiteboard/create`);

    const loading = docLoading || wbLoading;
    const added = pendingCreate && !loading;

    const handleInput = useCallback((value: string) => {
        setName(value);
    }, []);

    const handleSubmit = async (ev: MouseEvent<HTMLButtonElement>) => {
        ev.preventDefault();
        if (disabled) {
            return;
        }
        setPendingCreate(true);
        if (pageType === "document") {
            createDoc({ title: name, spaceId, parentId });
        } else {
            createWb({ title: name, spaceId, parentId });
        }
    };

    useEffect(() => {
        if (!pendingCreate) {
            return;
        }
        if (docData?.data?.page) {
            setPendingCreate(false);
            editPage(docData.data.page);
        } else if (wbData?.data?.page) {
            setPendingCreate(false);
            editPage(wbData.data.page);
        }
    }, [docData, wbData, editPage, pendingCreate]);

    useEffect(() => {
        if (!loading && pendingCreate && (docErrors || wbErrors)) {
            setPendingCreate(false);
        }
    }, [docErrors, wbErrors, loading, pendingCreate]);

    useEffect(() => {
        if (!isOpen) {
            setName("");
            setPageType("document");
            setPendingCreate(false);
        }
    }, [isOpen]);

    return (
        <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
            <Dialog.Content maxWidth="520px">
                <Dialog.Title size="6">Create new page</Dialog.Title>
                <Dialog.Description size="2" color="gray" mb="4">
                    Choose the page type and title. This page will be added under the current location.
                </Dialog.Description>
                <Flex direction="column" gap="4">
                    {disabled ? (
                        <Text size="2" color="red">
                            {disabledMessage}
                        </Text>
                    ) : null}
                    <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                            Page Type
                        </Text>
                        <Select.Root value={pageType} onValueChange={(val: "document" | "whiteboard") => setPageType(val)}>
                            <Select.Trigger className="w-full" />
                            <Select.Content>
                                <Select.Item value="document">Document</Select.Item>
                                <Select.Item value="whiteboard">Whiteboard</Select.Item>
                            </Select.Content>
                        </Select.Root>
                    </label>
                    <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                            Page Title
                        </Text>
                        <TextField.Root
                            value={name}
                            onChange={(ev) => handleInput(ev.target.value)}
                            placeholder="Untitled page"
                        />
                    </label>
                    <Flex gap="3" mt="4" justify="end">
                        <Dialog.Close>
                            <Button variant="surface" color="gray">
                                Cancel
                            </Button>
                        </Dialog.Close>
                        <Button onClick={handleSubmit} disabled={disabled || loading || added || !name.trim()} loading={loading}>
                            Create
                        </Button>
                    </Flex>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
