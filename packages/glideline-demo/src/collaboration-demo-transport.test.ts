import { describe, expect, it, vi } from 'vitest';
import { CollaborationDemoTransport } from './collaboration-demo-transport';

describe('CollaborationDemoTransport', () => {
  it('relays document and awareness updates in both directions', () => {
    const transport = new CollaborationDemoTransport();
    transport.docA.getMap('records').set('shape:a', { x: 10 });
    expect(transport.docB.getMap('records').get('shape:a')).toEqual({ x: 10 });

    transport.awarenessA.setLocalStateField('user', { id: 'a', name: 'Asha' });
    expect(transport.awarenessB.getStates().get(transport.awarenessA.clientID)?.user).toEqual({ id: 'a', name: 'Asha' });
    transport.destroy();
  });

  it('converges edits made independently while a client is offline', () => {
    const transport = new CollaborationDemoTransport();
    transport.setOnline('b', false);
    transport.docA.getMap('records').set('shape:a', { x: 10 });
    transport.docB.getMap('records').set('shape:b', { x: 20 });
    expect(transport.docA.getMap('records').has('shape:b')).toBe(false);
    expect(transport.docB.getMap('records').has('shape:a')).toBe(false);

    transport.setOnline('b', true);
    expect(transport.docA.getMap('records').get('shape:b')).toEqual({ x: 20 });
    expect(transport.docB.getMap('records').get('shape:a')).toEqual({ x: 10 });
    transport.destroy();
  });

  it('queues paused traffic and can flush delayed delivery', () => {
    vi.useFakeTimers();
    const transport = new CollaborationDemoTransport();
    transport.setPaused(true);
    transport.docA.getMap('records').set('shape:a', { x: 10 });
    expect(transport.snapshot().queuedMessages).toBe(1);
    expect(transport.docB.getMap('records').has('shape:a')).toBe(false);

    transport.setPaused(false);
    expect(transport.docB.getMap('records').get('shape:a')).toEqual({ x: 10 });
    transport.setLatency(500);
    transport.docB.getMap('records').set('shape:b', { x: 20 });
    expect(transport.snapshot().queuedMessages).toBe(1);
    transport.flush();
    expect(transport.docA.getMap('records').get('shape:b')).toEqual({ x: 20 });
    transport.destroy();
    vi.useRealTimers();
  });

  it('cancels deferred disposal when React Strict Mode subscribes again', async () => {
    const transport = new CollaborationDemoTransport();
    const unsubscribe = transport.subscribe(() => undefined);
    unsubscribe();
    transport.scheduleDestroy();
    const replayUnsubscribe = transport.subscribe(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 5));

    transport.docA.getMap('records').set('shape:a', { x: 10 });
    expect(transport.docB.getMap('records').get('shape:a')).toEqual({ x: 10 });
    replayUnsubscribe();
    transport.destroy();
  });
});
