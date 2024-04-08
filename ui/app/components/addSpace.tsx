'use client'
import { useMutation } from "@apollo/client";
import { client } from "@http";
import { GRAPHQL_ADD_SPACE } from "@queries/space";
import { Button, Label, Modal, TextInput } from "flowbite-react";
import { MouseEvent, useCallback, useRef, useState } from "react";
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
    const spaceNameRef = useRef();


    const onDialogClose = useCallback(() => {
        setIsOpen(false);
    }, []);

    const handleInput = useCallback((value: string) => {
        setName(value);
    }, []);

    const handleSubmit = async (ev: MouseEvent<HTMLButtonElement>) => {
        ev.preventDefault();
        await mutateFunction({ variables: { name: name } });
        setIsOpen(false);
    };

    return (
        <>
            <Modal dismissible show={isOpen} onClose={() => onDialogClose()} initialFocus={spaceNameRef}>
                <Modal.Header>Create new space.</Modal.Header>
                <Modal.Body>
                    <div>
                        <div>
                            <div className="mb-2 block">
                                <Label htmlFor="name" value="Space name" />
                            </div>
                            <TextInput
                                id="name"
                                placeholder="Engineering"
                                value={name}
                                ref={spaceNameRef}
                                onChange={(event) => setName(event.target.value)}
                                required
                            />
                        </div>
                        <div className="w-full mt-6 flex-row-reverse">
                            <Button onClick={handleSubmit} isProcessing={loading} disabled={loading}>create</Button>
                        </div>
                    </div>
                </Modal.Body>
            </Modal>
        </>
    )
}
