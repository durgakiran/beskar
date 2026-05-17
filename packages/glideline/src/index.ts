/**
 * Glideline — Public API surface (Phase 1)
 */

// Types
export type {
  ShapeId, BindingId, PageId,
  GlideShape, GlideBinding, BaseRecord, AnyRecord,
  Box2d, Vec2, EdgeName,
  GlideDocument,
  Validator, GlideProps,
  GlideMigrations, GlideMigrator,
} from './types';
export { sid, bid, pid, makeBox, isGlideBinding } from './types';

// Validators
export { T } from './validators';

// Migrations
export { defineMigrations, migrateRecord, migrateRecordDown } from './migrations';

// Schema
export { GlideSchema, CURRENT_STORE_VERSION } from './schema';

// Store
export { GlideStore } from './store';

// Shapes
export { ShapeUtil, BindingUtil } from './shapes/ShapeUtil';
