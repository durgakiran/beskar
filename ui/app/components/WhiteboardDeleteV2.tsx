import { useRef, useState } from 'react';
import { Button, Dialog, Flex, Text } from '@radix-ui/themes';
import { boardUrl, checkedFetch } from 'app/core/whiteboard/v2/api';
export default function WhiteboardDeleteV2({ spaceId, pageId, open, onOpenChange, onDeleted }: { spaceId: string; pageId: string; open: boolean; onOpenChange: (open: boolean) => void; onDeleted: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const inFlight = useRef(false);
    const remove = async () => {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); setError('');
        try { await checkedFetch(boardUrl(spaceId, pageId), { method: 'DELETE' }); onOpenChange(false); onDeleted(); }
        catch (e) { setError((e as Error).message); }
        finally { inFlight.current = false; setBusy(false); }
    };
    return <Dialog.Root open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}><Dialog.Content maxWidth="450px">
        <Dialog.Title>Delete whiteboard</Dialog.Title>
        <Dialog.Description>Permanently delete this whiteboard, its draft, published versions, and previews? This cannot be undone. Move or delete any child pages first.</Dialog.Description>
        {error && <Text as="p" role="alert" color="red">{error}</Text>}
        <Flex gap="3" mt="4" justify="end"><Button variant="soft" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button color="red" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete whiteboard'}</Button></Flex>
    </Dialog.Content></Dialog.Root>;
}
