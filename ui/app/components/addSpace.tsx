'use client'
import { Response, usePost } from "@http/hooks";
import { Button, Label, Modal, TextInput } from "flowbite-react";
import { MouseEvent, useCallback, useEffect, useRef, useState } from "react";


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
    const spaceNameRef = useRef();


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
