/**
 * Unit tests: T validator system
 * Covers spec test IDs: T1.2-01 through T1.2-05
 */

import { describe, it, expect } from 'vitest';
import { T } from './validators';

describe('T.number', () => {
  it('T1.2-01 accepts a number', () => {
    expect(T.number.validate(42)).toBe(42);
    expect(T.number.validate(0)).toBe(0);
    expect(T.number.validate(-1.5)).toBe(-1.5);
  });

  it('T1.2-01 rejects non-number with "Expected number"', () => {
    expect(() => T.number.validate('hi')).toThrow(/Expected number/);
    expect(() => T.number.validate(null)).toThrow(/Expected number/);
    expect(() => T.number.validate(true)).toThrow(/Expected number/);
    expect(() => T.number.validate(undefined)).toThrow(/Expected number/);
  });
});

describe('T.string', () => {
  it('accepts a string', () => {
    expect(T.string.validate('hello')).toBe('hello');
    expect(T.string.validate('')).toBe('');
  });

  it('rejects non-string', () => {
    expect(() => T.string.validate(42)).toThrow(/Expected string/);
    expect(() => T.string.validate(false)).toThrow(/Expected string/);
  });
});

describe('T.boolean', () => {
  it('accepts a boolean', () => {
    expect(T.boolean.validate(true)).toBe(true);
    expect(T.boolean.validate(false)).toBe(false);
  });

  it('rejects non-boolean', () => {
    expect(() => T.boolean.validate(1)).toThrow(/Expected boolean/);
    expect(() => T.boolean.validate('true')).toThrow(/Expected boolean/);
  });
});

describe('T.literal', () => {
  it('accepts exact match', () => {
    expect(T.literal('red').validate('red')).toBe('red');
    expect(T.literal(42).validate(42)).toBe(42);
    expect(T.literal(true).validate(true)).toBe(true);
  });

  it('rejects non-matching value', () => {
    expect(() => T.literal('red').validate('blue')).toThrow();
    expect(() => T.literal(1).validate(2)).toThrow();
  });
});

describe('T.optional', () => {
  it('T1.2-02 passes undefined through', () => {
    expect(T.optional(T.number).validate(undefined)).toBe(undefined);
  });

  it('T1.2-02 validates the inner type when value is present', () => {
    expect(T.optional(T.number).validate(3)).toBe(3);
  });

  it('T1.2-02 throws when value is invalid (not undefined, not the inner type)', () => {
    expect(() => T.optional(T.number).validate('x')).toThrow(/Expected number/);
  });
});

describe('T.union', () => {
  it('T1.2-03 matches first valid validator', () => {
    expect(T.union(T.string, T.number).validate('ok')).toBe('ok');
    expect(T.union(T.string, T.number).validate(5)).toBe(5);
  });

  it('T1.2-03 throws with "union member" message when no validator matches', () => {
    expect(() => T.union(T.string, T.number).validate(true)).toThrow(/union member/);
    expect(() => T.union(T.literal('a'), T.literal('b')).validate('c')).toThrow(/union member/);
  });
});
