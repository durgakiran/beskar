import { useEffect, useState } from 'react';
import { getApiV1Base } from '../http/apiBase';

export type CommentEventsData = {
  type: string;
  documentId: string;
  payload: any;
};

export function useCommentEvents(pageId: string) {
  const [lastEvent, setLastEvent] = useState<CommentEventsData | null>(null);

  useEffect(() => {
    if (!pageId) return;

    // We can use standard native EventSource because we have withCredentials set
    // which automatically passes the Zitadel session cookie for authentication!
    const sse = new EventSource(`${getApiV1Base()}/comment/documents/${pageId}/events`, {
      withCredentials: true,
    });

    sse.onmessage = (event) => {
      try {
        const msg: CommentEventsData = JSON.parse(event.data);
        if (msg.documentId === pageId) {
          setLastEvent(msg);
        }
      } catch (err) {
        console.error('Failed to parse SSE comment event:', err);
      }
    };

    sse.onerror = (err) => {
      console.error('SSE Error in comment events:', err);
      // EventSource automatically attempts reconnection
    };

    return () => {
      sse.close();
    };
  }, [pageId]);

  return lastEvent;
}
