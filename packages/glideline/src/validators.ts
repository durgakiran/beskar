/**
 * Glideline — T validator system (Phase 1)
 *
 * Lightweight O(1) validators run on every store.put().
 * Unlike Zod, these compose cleanly with the migration pipeline.
 * Zod is reserved for external/MCP API validation only.
 */

import type { Validator, GlideProps } from './types.js';

export type { Validator, GlideProps };

type ValidatorValue<V> = V extends Validator<infer T> ? T : never;

export const T = {
  number: {
    validate(v: unknown): number {
      if (typeof v !== 'number') {
        throw new Error(`Expected number, got ${typeof v}`);
      }
      return v;
    },
  } as Validator<number>,

  string: {
    validate(v: unknown): string {
      if (typeof v !== 'string') {
        throw new Error(`Expected string, got ${typeof v}`);
      }
      return v;
    },
  } as Validator<string>,

  boolean: {
    validate(v: unknown): boolean {
      if (typeof v !== 'boolean') {
        throw new Error(`Expected boolean, got ${typeof v}`);
      }
      return v;
    },
  } as Validator<boolean>,

  literal<V extends string | number | boolean>(expected: V): Validator<V> {
    return {
      validate(v: unknown): V {
        if (v !== expected) {
          throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(v)}`);
        }
        return v as V;
      },
    };
  },

  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return {
      validate(v: unknown): T | undefined {
        if (v === undefined) return undefined;
        return inner.validate(v);
      },
    };
  },

  union<const V extends readonly Validator<any>[]>(...validators: V): Validator<ValidatorValue<V[number]>> {
    return {
      validate(v: unknown): ValidatorValue<V[number]> {
        for (const val of validators) {
          try { return val.validate(v); } catch { /* try next */ }
        }
        throw new Error(`Value did not match any union member: ${JSON.stringify(v)}`);
      },
    };
  },
};
