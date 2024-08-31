"use client";
import { MouseEvent, useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { Button, Spinner, TextInput, Modal } from "flowbite-react";
import { Response, usePost } from "@http/hooks";

const Footer = styled.div`
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-content: center;
    justify-content: flex-end;
    align-items: center;
    box-sizing: border-box;
    margin-top: 1rem;
`;

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
        <Modal show={isOpen} onClose={closeModal} size="sm">
            <Modal.Header>Add a new Page</Modal.Header>
            <div className="form p-4">
                <div>
                    <h2>Title of Page</h2>
                    <TextInput className="w-4/5 " value={name} onInput={(ev) => handleInput((ev.target as HTMLInputElement).value)} placeholder="Enter page title..." />
                </div>
                <Footer>
                    <Button onClick={handleSubmit} disabled={loading || added}>
                        {loading ? <Spinner size="small" /> : "Add"}
                    </Button>
                </Footer>
            </div>
        </Modal>
    );
}
