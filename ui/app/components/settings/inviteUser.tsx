import { Button, Dropdown, Label, Modal, Select, TextInput } from "flowbite-react";
import { FormEvent, useState } from "react";

export default function InviteUser({ open, setOpen, handleInvite }: { open: boolean; setOpen: (open: boolean) => void; handleInvite: (email: string, role: string) => void }) {
    const [isLoading, setIsLoading] = useState<boolean>(false);


    const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
        ev.preventDefault();
        setIsLoading(true);

        try {
            const formData = new FormData(ev.currentTarget);
            handleInvite(formData.get("email") as string, formData.get("role") as string);
        } catch (error) {
            console.log(error);
        }
    }



    return (
        <Modal show={open} onClose={() => setOpen(false)}>
            <Modal.Header>Invite User</Modal.Header>
            <form onSubmit={onSubmit}>
                <Modal.Body>
                    <div className="mb-2 block">
                        <Label htmlFor="email" value="Select user" />
                    </div>
                    <div className="mb-2 block">
                        <TextInput type="email" name="email" id="email" placeholder="type email" required  />
                    </div>
                    <div className="mb-2 block">
                        <Label htmlFor="role" value="Select roles" />
                    </div>
                    <Select id="role" name="role" required>
                        <option value={"admin"}>Admin</option>
                        <option value={"editor"}>Editor</option>
                        <option value={"commenter"}>Commenter</option>
                        <option value={"viewer"}>Viewer</option>
                    </Select>
                </Modal.Body>
                <Modal.Footer >
                    <Button type="submit">Invite</Button>
                </Modal.Footer>
            </form>
        </Modal>
    )
}
