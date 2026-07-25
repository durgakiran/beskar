export { Glideboard } from './Glideboard';
export type {
  GlideboardProps,
  GlideboardHandle,
  GlideboardExportSvgOptions,
  GlideboardDocumentChangeContext,
  GlideboardUser,
  GlideboardCollaborationConfig,
  GlideboardCollaborationProvider,
  GlideboardAssetStorage,
  InitialDocumentDisposition,
  RecoverableTextDraft,
} from './types';
export type {
  CollaborationCheckpointSource,
  MutationFence,
  ProjectedYjsState,
  ProjectionStatus,
  ProjectionTarget,
  YjsProjectionCheckpoint,
} from './durability/types';
export { parseAwarenessUser, parseAwarenessCursor, safeAwarenessEntries } from './collaboration/awareness';
export { createSvgPathShape } from '@durgakiran/glideline';
