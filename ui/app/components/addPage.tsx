'use client'
import { useMutation } from "@apollo/client";
import { client } from "@http";
import { Box,FormControl } from "@primer/react";
import { GRAPHQL_ADD_PAGE } from "@queries/space";
import { useRouter } from "next/navigation";
import { MouseEvent, useCallback, useEffect, useState } from "react";
import styled from 'styled-components';
import { Button,Spinner,TextInput, Alert,Modal } from "flowbite-react";



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
    parentId?: string;
    setIsOpen: (open: boolean) => void;
}
export default function AddPage({ isOpen, setIsOpen, spaceId, parentId }: IAddPage) {
    const [name, setName] = useState('');
    const [mutateFunction, { data, loading, error }] = useMutation(GRAPHQL_ADD_PAGE, { client: client });
    const router = useRouter();

        
    const handleInput = useCallback((value: string) => {
        setName(value);
    }, []);

    const handleSubmit  = async (ev: MouseEvent<HTMLButtonElement>) => {
        ev.preventDefault();
        await mutateFunction({ variables: { parentId, spaceId, data: "", title: name } });
    };
    const closeModal = () => {
        setIsOpen(false); // Update parent component's state to reflect modal closure
    };

    useEffect(() => {
        if (data) {
            router.push(`/edit/${data.insert_core_page.returning[0].id}`);
        }
    }, [data]);


    return (
        <Modal show={isOpen} onClose={closeModal}  size="sm">
            <Modal.Header>
                Add a new Page
            </Modal.Header>
            < Box as="form" p="2">  
                <FormControl>
                    <FormControl.Label>Title of Page</FormControl.Label>
                    <TextInput className="w-3/4" value={name} onInput={(ev) => handleInput((ev.target as HTMLInputElement).value)} placeholder="Enter page title..." />
                </FormControl>
                <Footer>
                    <Button onClick={handleSubmit} disabled={loading}>
                        {loading ? <Spinner size="small" /> : <>Add</> }
                    </Button>
                </Footer>
            </Box>
        </Modal>
    )
}