"use client";

import { Cross2Icon } from "@radix-ui/react-icons";
import { Button, Dialog, Flex, IconButton, Text, TextArea, TextField } from "@radix-ui/themes";
import { CreateSpaceModalProps } from "./types";

export function CreateSpaceModal({
    open,
    onOpenChange,
    value,
    onValueChange,
    descriptionValue = "",
    onDescriptionChange,
    onSubmit,
    loading = false,
    title = "Create New Space",
    description = "Give your new space a clear title and short description.",
    label = "Space name",
    placeholder = "Engineering",
    descriptionLabel = "Description",
    descriptionPlaceholder = "What is this space for?",
    submitLabel = "Create",
    cancelLabel = "Cancel",
    errorMessage,
}: CreateSpaceModalProps) {
    const canSubmit = value.trim().length > 0 && (!onDescriptionChange || descriptionValue.trim().length > 0);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content size="2" maxWidth="472px">
                {!loading ? (
                    <Dialog.Close>
                        <IconButton
                            type="button"
                            variant="ghost"
                            color="gray"
                            className="!absolute right-4 top-4"
                            aria-label="Close create space modal"
                        >
                            <Cross2Icon />
                        </IconButton>
                    </Dialog.Close>
                ) : null}
                <Dialog.Title className="!mb-1">{title}</Dialog.Title>
                <Dialog.Description className="!mb-5 text-neutral-600">{description}</Dialog.Description>
                <Flex direction="column" gap="4">
                    <label>
                        <Text as="div" size="2" mb="2" weight="medium">
                            {label}
                        </Text>
                        <TextField.Root
                            value={value}
                            placeholder={placeholder}
                            onChange={(event) => onValueChange(event.target.value)}
                        />
                    </label>
                    {onDescriptionChange ? (
                        <label>
                            <Text as="div" size="2" mb="2" weight="medium">
                                {descriptionLabel}
                            </Text>
                            <TextArea
                                value={descriptionValue}
                                placeholder={descriptionPlaceholder}
                                onChange={(event) => onDescriptionChange(event.target.value)}
                                rows={4}
                                resize="vertical"
                            />
                        </label>
                    ) : null}
                    {errorMessage ? <Text size="2" className="text-error-600">{errorMessage}</Text> : null}
                    <Flex gap="3" justify="end" mt="2">
                        {!loading ? (
                            <Dialog.Close>
                                <Button variant="soft" color="gray" type="button">
                                    {cancelLabel}
                                </Button>
                            </Dialog.Close>
                        ) : null}
                        <Button onClick={onSubmit} loading={loading} disabled={loading || !canSubmit}>
                            {submitLabel}
                        </Button>
                    </Flex>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
