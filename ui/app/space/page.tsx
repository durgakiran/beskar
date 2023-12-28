'use client'
import { Box, Button, Dialog, FormControl, TextInput } from "@primer/react";
import { MouseEvent, useCallback, useEffect, useState } from "react";
import { client, post } from "@http";
import styled from 'styled-components';
import { ApolloProvider, gql, useQuery } from "@apollo/client";

const Container = styled.div`
    text-align: center;
`;

const CenteredButton = styled(Button)`
    margin: auto;
`;

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

const GRAPHQL_GET_SPACES = gql`
    query GetSpace {
        core_space {
            name
            date_created
            date_updated
            id
        }
    }
`;

export default function Page() {

    const [isOpen, setIsOpen] = useState(false);
    const [name, setName] = useState('');
    const { loading, error, data } = useQuery(GRAPHQL_GET_SPACES, { client: client });

    const onDialogClose = useCallback(() => {
        setIsOpen(false);
    }, []);

    const handleInput = useCallback((value: string) => {
        setName(value);
    }, []);

    const handleSubmit  = useCallback(async (ev: MouseEvent<HTMLButtonElement>) => {
        console.log(name);
    }, [name]);

    useEffect(() => {
        console.log(error);
        console.log(data);
    }, [loading])

    return (
        <Container>
            <Box>

            </Box>
            <h1>Create Spaces</h1>
            <CenteredButton size="large" onClick={() => { setIsOpen(true)}}>+ Space</CenteredButton>
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
                        <Button onClick={handleSubmit}>
                            Add
                        </Button>
                    </Footer>
                </Box>
            </Dialog>
        </Container>
    )
}
