import { MouseEvent, useCallback, useEffect, useState } from "react";
import { Dialog, Button, TextField, Flex, Text } from "@radix-ui/themes";
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
    const [{ data: whiteboardData, isLoading: whiteboardLoading, errors: whiteboardErrors }, createWhiteboard] = usePost<Response<PageResponse>, Page>(`editor/space/${spaceId}/whiteboard/create`);

    const loading = docLoading || whiteboardLoading;
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
        const payload = { title: name, spaceId, parentId };
        if (pageType === "whiteboard") {
            createWhiteboard(payload);
            return;
        }
        createDoc(payload);
    };

    useEffect(() => {
        if (!pendingCreate) {
            return;
        }
        const createdPageId = docData?.data?.page || whiteboardData?.data?.page;
        if (createdPageId) {
            setPendingCreate(false);
            editPage(createdPageId);
        }
    }, [docData, editPage, pendingCreate, whiteboardData]);

    useEffect(() => {
        if (!loading && pendingCreate && (docErrors || whiteboardErrors)) {
            setPendingCreate(false);
        }
    }, [docErrors, loading, pendingCreate, whiteboardErrors]);

    useEffect(() => {
        if (!isOpen) {
            setName("");
            setPendingCreate(false);
            setPageType("document");
        }
    }, [isOpen]);

    return (
        <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
            <Dialog.Content maxWidth="520px">
                <Dialog.Title size="6">Create new page</Dialog.Title>
                <Dialog.Description size="2" color="gray" mb="4">
                    Choose a page type and title. The page will be created under the current location.
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
                        <Flex gap="2">
                            <Button
                                type="button"
                                variant={pageType === "document" ? "solid" : "soft"}
                                onClick={() => setPageType("document")}
                            >
                                Document
                            </Button>
                            <Button
                                type="button"
                                variant={pageType === "whiteboard" ? "solid" : "soft"}
                                onClick={() => setPageType("whiteboard")}
                            >
                                Whiteboard
                            </Button>
                        </Flex>
                    </label>
                    <label>
                        <Text as="div" size="2" mb="1" weight="bold">
                            Page Title
                        </Text>
                        <TextField.Root
                            value={name}
                            onChange={(ev) => handleInput(ev.target.value)}
                            placeholder={pageType === "whiteboard" ? "Untitled whiteboard" : "Untitled page"}
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
