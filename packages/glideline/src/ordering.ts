import type { GlideShape, ShapeId } from './types.js';

const ORDER_PREFIX = 'o';
const ORDER_RADIX = 36n;
const ORDER_WIDTH = 24;
const ORDER_MAX = ORDER_RADIX ** BigInt(ORDER_WIDTH) - 1n;
const ORDER_KEY_PATTERN = new RegExp(`^${ORDER_PREFIX}[0-9a-z]{${ORDER_WIDTH}}$`);

export const ROOT_ORDER_PARENT = '$root';

export class OrderKeySpaceExhaustedError extends Error {
  constructor() {
    super('No fractional order-key space remains between these siblings.');
    this.name = 'OrderKeySpaceExhaustedError';
  }
}

export function isCanonicalOrderKey(value: unknown): value is string {
  return typeof value === 'string' && ORDER_KEY_PATTERN.test(value);
}

function parseOrderKey(value: string): bigint {
  if (!isCanonicalOrderKey(value)) throw new Error(`Invalid canonical order key "${value}".`);
  let result = 0n;
  for (const character of value.slice(ORDER_PREFIX.length)) {
    result = result * ORDER_RADIX + BigInt(parseInt(character, 36));
  }
  return result;
}

function formatOrderKey(value: bigint): string {
  if (value <= 0n || value >= ORDER_MAX) throw new OrderKeySpaceExhaustedError();
  return `${ORDER_PREFIX}${value.toString(36).padStart(ORDER_WIDTH, '0')}`;
}

/** Generate `count` lexicographically ordered keys strictly between the bounds. */
export function generateOrderKeysBetween(
  lower: string | null,
  upper: string | null,
  count: number,
): readonly string[] {
  if (!Number.isInteger(count) || count < 0) throw new Error('Order-key count must be a non-negative integer.');
  if (count === 0) return Object.freeze([]);
  const lowerValue = lower === null ? 0n : parseOrderKey(lower);
  const upperValue = upper === null ? ORDER_MAX : parseOrderKey(upper);
  if (lowerValue >= upperValue) throw new Error('Order-key lower bound must be below its upper bound.');
  const step = (upperValue - lowerValue) / BigInt(count + 1);
  if (step < 1n) throw new OrderKeySpaceExhaustedError();
  return Object.freeze(Array.from({ length: count }, (_, index) =>
    formatOrderKey(lowerValue + step * BigInt(index + 1))));
}

/** Evenly distribute a complete sibling set across the available key space. */
export function generateRebalancedOrderKeys(count: number): readonly string[] {
  return generateOrderKeysBetween(null, null, count);
}

export function getShapeOrderParentId(record: object): string {
  const orderable = record as { readonly parentId?: unknown; readonly pageId?: unknown };
  if (typeof orderable.parentId === 'string' && orderable.parentId.length > 0) return orderable.parentId;
  if (typeof orderable.pageId === 'string' && orderable.pageId.length > 0) return orderable.pageId;
  return ROOT_ORDER_PARENT;
}

/** Canonical sibling comparator. Higher values paint later and are visually on top. */
export function compareSiblingOrder(
  left: Pick<GlideShape, 'id' | 'index'>,
  right: Pick<GlideShape, 'id' | 'index'>,
): number {
  const leftIndex = String(left.index ?? '');
  const rightIndex = String(right.index ?? '');
  const byIndex = leftIndex < rightIndex ? -1 : leftIndex > rightIndex ? 1 : 0;
  const leftId = String(left.id);
  const rightId = String(right.id);
  return byIndex || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0);
}

function sortSiblings(shapes: readonly GlideShape[]): GlideShape[] {
  return [...shapes].sort(compareSiblingOrder);
}

/**
 * Return one deterministic hierarchy traversal. Parents paint before their
 * children; siblings use `(index, id)`. Root scopes are ordered by scope ID.
 */
export function getCanonicalShapeIds(shapes: readonly GlideShape[]): readonly ShapeId[] {
  const byId = new Map(shapes.map(shape => [String(shape.id), shape]));
  const children = new Map<string, GlideShape[]>();
  const roots = new Map<string, GlideShape[]>();

  for (const shape of shapes) {
    const parentId = 'parentId' in shape && typeof shape.parentId === 'string'
      ? shape.parentId
      : null;
    const target = parentId && byId.has(parentId) ? children : roots;
    const scope = parentId && byId.has(parentId) ? parentId : getShapeOrderParentId(shape);
    const members = target.get(scope) ?? [];
    members.push(shape);
    target.set(scope, members);
  }

  const result: ShapeId[] = [];
  const visit = (shape: GlideShape) => {
    result.push(shape.id as ShapeId);
    for (const child of sortSiblings(children.get(String(shape.id)) ?? [])) visit(child);
  };
  for (const scope of [...roots.keys()].sort()) {
    for (const shape of sortSiblings(roots.get(scope) ?? [])) visit(shape);
  }
  return Object.freeze(result);
}

export function sortShapesByCanonicalOrder(
  candidates: readonly GlideShape[],
  completeShapeSet: readonly GlideShape[],
): GlideShape[] {
  const rank = new Map(getCanonicalShapeIds(completeShapeSet).map((id, index) => [String(id), index]));
  return [...candidates].sort((left, right) => {
    const leftRank = rank.get(String(left.id));
    const rightRank = rank.get(String(right.id));
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    const leftParent = getShapeOrderParentId(left);
    const rightParent = getShapeOrderParentId(right);
    const byParent = leftParent < rightParent ? -1 : leftParent > rightParent ? 1 : 0;
    return byParent || compareSiblingOrder(left, right);
  });
}
