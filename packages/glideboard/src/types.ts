import type { GlideDocument } from '@durgakiran/glideline';

export interface GlideboardUser {
  id: string;
  name: string;
  color: string;
}

export interface GlideboardAwareness {
  setLocalStateField(field: string, value: unknown): void;
}

export interface GlideboardCollaborationProvider {
  awareness?: GlideboardAwareness;
}

export interface GlideboardMapKeyChange {
  action: 'add' | 'update' | 'delete';
}

export interface GlideboardMapEvent {
  changes: {
    keys: Map<string, GlideboardMapKeyChange>;
  };
}

export interface GlideboardSharedMap<T> {
  readonly size: number;
  values(): IterableIterator<T>;
  get(key: string): T | undefined;
  set(key: string, value: T): unknown;
  delete(key: string): void;
  observe(listener: (event: GlideboardMapEvent) => void): void;
  unobserve(listener: (event: GlideboardMapEvent) => void): void;
}

export interface GlideboardCollaborationDoc {
  getMap<T>(name: string): GlideboardSharedMap<T>;
  transact(fn: () => void, origin?: unknown): void;
}

export interface GlideboardCollaborationConfig {
  doc: GlideboardCollaborationDoc;
  provider?: GlideboardCollaborationProvider | null;
  user?: GlideboardUser | null;
}

export interface GlideboardProps {
  initialDocument?: GlideDocument | null;
  collaboration?: GlideboardCollaborationConfig | null;
  readOnly?: boolean;
  onDocumentChange?: (document: GlideDocument) => void;
  documentChangeDebounceMs?: number;
  debugApiKey?: string;
}
