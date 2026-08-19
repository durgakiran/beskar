import React from 'react';
import { Glideboard, type GlideboardCollaborationConfig } from '@durgakiran/glideboard';
import {
  CollaborationDemoTransport,
  type CollaborationDemoClient,
  type CollaborationDemoSnapshot,
} from './collaboration-demo-transport';

const INITIAL_SNAPSHOT: CollaborationDemoSnapshot = {
  onlineA: true,
  onlineB: true,
  paused: false,
  latencyMs: 0,
  queuedMessages: 0,
};

function ClientToggle({
  client,
  online,
  transport,
}: {
  client: CollaborationDemoClient;
  online: boolean;
  transport: CollaborationDemoTransport;
}) {
  return (
    <label className="collaboration-toggle">
      <input
        type="checkbox"
        checked={online}
        onChange={event => transport.setOnline(client, event.target.checked)}
      />
      Client {client.toUpperCase()}
    </label>
  );
}

export default function CollaborationDemo() {
  const [room, setRoom] = React.useState(() => ({
    generation: 0,
    transport: new CollaborationDemoTransport(),
  }));
  const { generation, transport } = room;
  const [snapshot, setSnapshot] = React.useState(INITIAL_SNAPSHOT);

  React.useEffect(() => {
    const unsubscribe = transport.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      transport.scheduleDestroy();
    };
  }, [transport]);

  const collaborationA = React.useMemo<GlideboardCollaborationConfig>(() => ({
    doc: transport.docA,
    provider: { awareness: transport.awarenessA, synced: true },
    user: { id: 'demo-user-a', name: 'Asha', color: '#2563eb' },
  }), [transport]);
  const collaborationB = React.useMemo<GlideboardCollaborationConfig>(() => ({
    doc: transport.docB,
    provider: { awareness: transport.awarenessB, synced: true },
    user: { id: 'demo-user-b', name: 'Ben', color: '#dc2626' },
  }), [transport]);

  return (
    <main className="collaboration-demo">
      <header className="collaboration-controls" aria-label="Collaboration controls">
        <div className="collaboration-control-group" aria-label="Connected clients">
          <ClientToggle client="a" online={snapshot.onlineA} transport={transport} />
          <ClientToggle client="b" online={snapshot.onlineB} transport={transport} />
        </div>
        <label className="collaboration-toggle">
          <input
            type="checkbox"
            checked={snapshot.paused}
            onChange={event => transport.setPaused(event.target.checked)}
          />
          Pause delivery
        </label>
        <label className="collaboration-latency">
          Latency
          <input
            type="range"
            min="0"
            max="1000"
            step="50"
            value={snapshot.latencyMs}
            onChange={event => transport.setLatency(Number(event.target.value))}
          />
          <output>{snapshot.latencyMs} ms</output>
        </label>
        <div className="collaboration-control-actions">
          <span className="collaboration-queue" aria-live="polite">Queued: {snapshot.queuedMessages}</span>
          <button type="button" onClick={() => transport.flush()} disabled={snapshot.queuedMessages === 0}>Flush</button>
          <button
            type="button"
            onClick={() => setRoom(current => ({
              generation: current.generation + 1,
              transport: new CollaborationDemoTransport(),
            }))}
          >
            Reset room
          </button>
        </div>
      </header>

      <section className="collaboration-boards">
        <article className="collaboration-client">
          <div className="collaboration-client-header">
            <strong>Asha</strong>
            <span className={snapshot.onlineA ? 'is-online' : 'is-offline'}>{snapshot.onlineA ? 'Online' : 'Offline'}</span>
          </div>
          <div className="collaboration-board" data-testid="collaboration-board-a">
            <Glideboard
              key={`collaboration-a-${generation}`}
              sessionKey={`collaboration-demo-a-${generation}`}
              collaboration={collaborationA}
              debugApiKey="__GLIDELINE_COLLABORATION_A__"
            />
          </div>
        </article>

        <article className="collaboration-client">
          <div className="collaboration-client-header">
            <strong>Ben</strong>
            <span className={snapshot.onlineB ? 'is-online' : 'is-offline'}>{snapshot.onlineB ? 'Online' : 'Offline'}</span>
          </div>
          <div className="collaboration-board" data-testid="collaboration-board-b">
            <Glideboard
              key={`collaboration-b-${generation}`}
              sessionKey={`collaboration-demo-b-${generation}`}
              collaboration={collaborationB}
              debugApiKey="__GLIDELINE_COLLABORATION_B__"
            />
          </div>
        </article>
      </section>
    </main>
  );
}
