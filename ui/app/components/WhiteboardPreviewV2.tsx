import { useEffect, useState } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';
import { boardUrl, contentUrl, jsonRequest, WhiteboardApiError, type PublishedBoard } from 'app/core/whiteboard/v2/api';

export default function WhiteboardPreviewV2({ spaceId, pageId, onTitle }: { spaceId: string; pageId: string; onTitle?: (title: string) => void }) {
    const [published, setPublished] = useState<PublishedBoard | null>(null);
    const [message, setMessage] = useState('Loading preview…');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const abort = new AbortController();
        setPublished(null); setMessage('Loading preview…');
        void jsonRequest<PublishedBoard>(`${boardUrl(spaceId, pageId)}/published`, { signal: abort.signal }).then(data => {
            if (abort.signal.aborted) return;
            setPublished(data); onTitle?.(data.snapshot.title);
            if (!data.preview) setMessage('This version has no preview. Publish it again from the editor to add one.');
        }).catch(e => {
            if (!abort.signal.aborted) setMessage(e instanceof WhiteboardApiError && e.code === 'WHITEBOARD_NOT_PUBLISHED' ? 'This whiteboard has not been published yet.' : 'Unable to load the published preview.');
        });
        return () => abort.abort();
    }, [spaceId, pageId, attempt, onTitle]);
    return published?.preview ? <img src={contentUrl(published.preview.url)} alt={published.snapshot.title} onError={() => { setPublished(null); setMessage('Unable to load the published preview.'); }} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : <Flex align="center" justify="center" direction="column" gap="3" height="100%"><Text>{message}</Text>{message.startsWith('Unable') ? <Button onClick={() => setAttempt(n => n + 1)}>Retry</Button> : null}</Flex>;
}
