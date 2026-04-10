"use client";

import { Button, Dialog, Flex } from "@radix-ui/themes";
import { useState } from "react";

export default function MemberActions({
    locked,
    disabled,
    onRemove,
}: {
    locked?: boolean;
    disabled?: boolean;
    onRemove?: () => void;
}) {
    const [open, setOpen] = useState(false);

    if (locked) {
        return (
            <Button variant="outline" disabled>
                Owner
            </Button>
        );
    }

    if (!onRemove) {
        return null;
    }

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger>
                <Button variant="outline" color="red" disabled={disabled}>
                    Remove
                </Button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="420px">
                <Dialog.Title>Remove member</Dialog.Title>
                <Dialog.Description size="2">
                    This user will lose access to the space immediately.
                </Dialog.Description>
                <Flex justify="end" gap="3" mt="4">
                    <Button variant="soft" color="gray" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        color="red"
                        onClick={() => {
                            onRemove();
                            setOpen(false);
                        }}
                    >
                        Remove
                    </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
