'use client'
import { useMutation } from "@apollo/client";
import { client } from "@http";
import { Box, Button, Dialog, FormControl, Spinner, TextInput } from "@primer/react";
import { GRAPHQL_ADD_SPACE } from "@queries/space";
import { MouseEvent, useCallback, useState } from "react";
import styled from 'styled-components';


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

interface IAddSpace {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
}

export default function AddSpace({ isOpen, setIsOpen }: IAddSpace) {
    const [name, setName] = useState('');
    const [mutateFunction, { data, loading, error }] = useMutation(GRAPHQL_ADD_SPACE, { client: client });


    const onDialogClose = useCallback(() => {
        setIsOpen(false);
    }, []);

    const handleInput = useCallback((value: string) => {
        setName(value);
    }, []);

    const handleSubmit  = async (ev: MouseEvent<HTMLButtonElement>) => {
        ev.preventDefault();
        await mutateFunction({ variables: { name: name } });
        setIsOpen(false);
    };

    return (
        <Dialog isOpen={isOpen} width="small" onDismiss={onDialogClose}>
            <Dialog.Header>
                Add Space
            </Dialog.Header>
            <Box as="form" p="3">
                <FormControl>
                    <FormControl.Label>Name of space</FormControl.Label>
                    <TextInput value={name} onInput={(ev) => handleInput((ev.target as HTMLInputElement).value)} placeholder="Enter space name..." />
                </FormControl>
                <Footer>
                    <Button onClick={handleSubmit} disabled={loading}>
                        {loading ? <Spinner size="small" /> : <>Add</> }
                    </Button>
                </Footer>
            </Box>
        </Dialog>
    )
}
