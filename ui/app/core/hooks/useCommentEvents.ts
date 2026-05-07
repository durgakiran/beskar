import { useEffect, useState } from 'react';
import { getApiV1Base } from '../http/apiBase';

export type CommentEventsData = {
  type: string;
  documentId: string;
  payload: any;
};

function parseServerSentEvent(rawEvent: string): CommentEventsData | null {
  const data = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (!data) return null;
  return JSON.parse(data) as CommentEventsData;
}

export function useCommentEvents(pageId: string) {
  const [lastEvent, setLastEvent] = useState<CommentEventsData | null>(null);

  useEffect(() => {
    if (!pageId) return;

    const controller = new AbortController();
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = async () => {
      try {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`${getApiV1Base()}/comment/documents/${pageId}/events`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: token ? 'same-origin' : 'include',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Comment event stream failed with status ${response.status}`);
        }
        if (!response.body) {
          throw new Error('Comment event stream response has no body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');

          while (boundary >= 0) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf('\n\n');

            try {
              const msg = parseServerSentEvent(rawEvent);
              if (msg?.documentId === pageId) {
                setLastEvent(msg);
              }
            } catch (err) {
              console.error('Failed to parse SSE comment event:', err);
            }
          }
        }
      } catch (err: any) {
        if (stopped || err?.name === 'AbortError') return;
        console.error('SSE Error in comment events:', err);
      }

      if (!stopped) {
        reconnectTimer = window.setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [pageId]);

  return lastEvent;
}
