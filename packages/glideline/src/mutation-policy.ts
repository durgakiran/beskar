export type MutationOrigin =
  | 'local-user'
  | 'local-api'
  | 'remote'
  | 'load'
  | 'system'

export interface MutationRequest {
  readonly origin: MutationOrigin;
  readonly command: string;
  readonly affectedIds: readonly string[];
}

export interface MutationPolicy {
  authorize(request: MutationRequest): 'allow' | 'deny';
}

export const allowAllMutations: MutationPolicy = {
  authorize: () => 'allow',
}

declare const mutationCapabilityBrand: unique symbol;

/** Identity-checked authority granted by the host that created an editor. */
export interface MutationCapability {
  readonly [mutationCapabilityBrand]: true;
}

export interface MutationCapabilityGrant {
  readonly capability: MutationCapability;
  readonly origins: readonly MutationOrigin[];
}

export function createMutationCapability(): MutationCapability {
  return Object.freeze({}) as MutationCapability;
}

export class MutationPermissionError extends Error {
  readonly code = 'MUTATION_PERMISSION_DENIED';
  readonly request: MutationRequest;

  constructor(request: MutationRequest) {
    super(`Mutation "${request.command}" from origin "${request.origin}" is not permitted`);
    this.name = 'MutationPermissionError';
    this.request = Object.freeze({
      ...request,
      affectedIds: Object.freeze([...request.affectedIds]),
    });
  }
}
