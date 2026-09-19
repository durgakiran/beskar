import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';

export type CollaborationDemoClient = 'a' | 'b';

export interface CollaborationDemoSnapshot {
  onlineA: boolean;
  onlineB: boolean;
  paused: boolean;
  latencyMs: number;
  queuedMessages: number;
}

type Packet = {
  source: CollaborationDemoClient;
  target: CollaborationDemoClient;
  kind: 'document' | 'awareness';
  update: Uint8Array;
};

const otherClient = (client: CollaborationDemoClient): CollaborationDemoClient => client === 'a' ? 'b' : 'a';

export class CollaborationDemoTransport {
  readonly docA = new Y.Doc();
  readonly docB = new Y.Doc();
  readonly awarenessA = new Awareness(this.docA);
  readonly awarenessB = new Awareness(this.docB);

  private online: Record<CollaborationDemoClient, boolean> = { a: true, b: true };
  private paused = false;
  private latencyMs = 0;
  private queued: Packet[] = [];
  private pending = new Map<ReturnType<typeof setTimeout>, Packet>();
  private listeners = new Set<(snapshot: CollaborationDemoSnapshot) => void>();
  private readonly remoteOrigins = { a: Symbol('remote-a'), b: Symbol('remote-b') };
  private destroyTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor() {
    this.docA.on('update', this.handleDocumentA);
    this.docB.on('update', this.handleDocumentB);
    this.awarenessA.on('update', this.handleAwarenessA);
    this.awarenessB.on('update', this.handleAwarenessB);
  }

  snapshot = (): CollaborationDemoSnapshot => ({
    onlineA: this.online.a,
    onlineB: this.online.b,
    paused: this.paused,
    latencyMs: this.latencyMs,
    queuedMessages: this.queued.length + this.pending.size,
  });

  subscribe = (listener: (snapshot: CollaborationDemoSnapshot) => void): (() => void) => {
    if (this.destroyTimer !== null) {
      clearTimeout(this.destroyTimer);
      this.destroyTimer = null;
    }
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  };

  scheduleDestroy(): void {
    if (this.disposed || this.destroyTimer !== null) return;
    this.destroyTimer = setTimeout(() => {
      this.destroyTimer = null;
      if (this.listeners.size === 0) this.destroy();
    }, 0);
  }

  setOnline(client: CollaborationDemoClient, online: boolean): void {
    if (this.disposed || this.online[client] === online) return;
    this.online[client] = online;
    const peer = otherClient(client);
    const clientAwareness = this.awareness(client);
    const peerAwareness = this.awareness(peer);

    if (!online) {
      removeAwarenessStates(peerAwareness, [clientAwareness.clientID], this.remoteOrigins[client]);
      removeAwarenessStates(clientAwareness, [peerAwareness.clientID], this.remoteOrigins[peer]);
      this.emit();
      return;
    }

    if (this.online[peer]) this.synchronizeClients();
    this.emit();
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      const queued = this.queued.splice(0);
      for (const packet of queued) this.schedule(packet);
    }
    this.emit();
  }

  setLatency(latencyMs: number): void {
    this.latencyMs = Math.max(0, Math.min(2000, Math.round(latencyMs)));
    this.emit();
  }

  flush(): void {
    if (this.disposed) return;
    const packets = this.queued.splice(0);
    for (const [timer, packet] of this.pending) {
      clearTimeout(timer);
      packets.push(packet);
    }
    this.pending.clear();
    for (const packet of packets) this.deliver(packet);
    this.emit();
  }

  synchronizeClients(): void {
    if (this.disposed || !this.online.a || !this.online.b) return;
    this.send({
      source: 'a',
      target: 'b',
      kind: 'document',
      update: Y.encodeStateAsUpdate(this.docA, Y.encodeStateVector(this.docB)),
    });
    this.send({
      source: 'b',
      target: 'a',
      kind: 'document',
      update: Y.encodeStateAsUpdate(this.docB, Y.encodeStateVector(this.docA)),
    });
    this.sendLocalAwareness('a');
    this.sendLocalAwareness('b');
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.destroyTimer !== null) clearTimeout(this.destroyTimer);
    this.destroyTimer = null;
    this.docA.off('update', this.handleDocumentA);
    this.docB.off('update', this.handleDocumentB);
    this.awarenessA.off('update', this.handleAwarenessA);
    this.awarenessB.off('update', this.handleAwarenessB);
    for (const timer of this.pending.keys()) clearTimeout(timer);
    this.pending.clear();
    this.queued = [];
    this.listeners.clear();
    this.awarenessA.destroy();
    this.awarenessB.destroy();
    this.docA.destroy();
    this.docB.destroy();
  }

  private readonly handleDocumentA = (update: Uint8Array, origin: unknown): void => {
    if (origin !== this.remoteOrigins.b) this.send({ source: 'a', target: 'b', kind: 'document', update });
  };

  private readonly handleDocumentB = (update: Uint8Array, origin: unknown): void => {
    if (origin !== this.remoteOrigins.a) this.send({ source: 'b', target: 'a', kind: 'document', update });
  };

  private readonly handleAwarenessA = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this.remoteOrigins.b) return;
    this.send({
      source: 'a',
      target: 'b',
      kind: 'awareness',
      update: encodeAwarenessUpdate(this.awarenessA, [...change.added, ...change.updated, ...change.removed]),
    });
  };

  private readonly handleAwarenessB = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this.remoteOrigins.a) return;
    this.send({
      source: 'b',
      target: 'a',
      kind: 'awareness',
      update: encodeAwarenessUpdate(this.awarenessB, [...change.added, ...change.updated, ...change.removed]),
    });
  };

  private sendLocalAwareness(client: CollaborationDemoClient): void {
    const awareness = this.awareness(client);
    if (awareness.getLocalState() === null) return;
    this.send({
      source: client,
      target: otherClient(client),
      kind: 'awareness',
      update: encodeAwarenessUpdate(awareness, [awareness.clientID]),
    });
  }

  private send(packet: Packet): void {
    if (this.disposed || !this.online[packet.source] || !this.online[packet.target]) return;
    if (this.paused) {
      this.queued.push(packet);
      this.emit();
      return;
    }
    this.schedule(packet);
  }

  private schedule(packet: Packet): void {
    if (this.latencyMs === 0) {
      this.deliver(packet);
      return;
    }
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      this.deliver(packet);
      this.emit();
    }, this.latencyMs);
    this.pending.set(timer, packet);
    this.emit();
  }

  private deliver(packet: Packet): void {
    if (!this.online[packet.source] || !this.online[packet.target]) return;
    if (packet.kind === 'document') {
      Y.applyUpdate(this.doc(packet.target), packet.update, this.remoteOrigins[packet.source]);
    } else {
      applyAwarenessUpdate(this.awareness(packet.target), packet.update, this.remoteOrigins[packet.source]);
    }
  }

  private doc(client: CollaborationDemoClient): Y.Doc {
    return client === 'a' ? this.docA : this.docB;
  }

  private awareness(client: CollaborationDemoClient): Awareness {
    return client === 'a' ? this.awarenessA : this.awarenessB;
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
