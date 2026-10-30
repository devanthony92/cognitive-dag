import { describe, expect, it } from 'vitest';
import {
  FieldTypeSchema,
  describeType,
  isAssignable,
  isTextConvertible,
  type DagType,
} from '../src/index.js';

const string: DagType = { kind: 'string' };
const number: DagType = { kind: 'number' };
const boolean: DagType = { kind: 'boolean' };
const datetime: DagType = { kind: 'datetime' };
const enumAB: DagType = { kind: 'enum', values: ['a', 'b'] };
const enumABC: DagType = { kind: 'enum', values: ['a', 'b', 'c'] };

describe('isAssignable (research R4)', () => {
  it('accepts identical primitives and rejects different ones', () => {
    for (const t of [string, number, boolean, datetime]) expect(isAssignable(t, t)).toBe(true);
    expect(isAssignable(string, number)).toBe(false);
    expect(isAssignable(number, string)).toBe(false);
    expect(isAssignable(datetime, string)).toBe(false);
    expect(isAssignable(boolean, number)).toBe(false);
  });

  it('allows enum -> string but not string -> enum', () => {
    expect(isAssignable(enumAB, string)).toBe(true);
    expect(isAssignable(string, enumAB)).toBe(false);
  });

  it('allows an enum into a wider enum only', () => {
    expect(isAssignable(enumAB, enumABC)).toBe(true);
    expect(isAssignable(enumABC, enumAB)).toBe(false);
  });

  it('compares lists by item type', () => {
    expect(isAssignable({ kind: 'list', item: enumAB }, { kind: 'list', item: string })).toBe(true);
    expect(isAssignable({ kind: 'list', item: string }, { kind: 'list', item: enumAB })).toBe(
      false,
    );
    expect(isAssignable({ kind: 'list', item: string }, string)).toBe(false);
  });

  it('compares objects by the target fields (extra source fields are fine)', () => {
    const source: DagType = { kind: 'object', fields: { a: enumAB, b: number } };
    expect(isAssignable(source, { kind: 'object', fields: { a: string } })).toBe(true);
    expect(isAssignable(source, { kind: 'object', fields: { a: string, c: string } })).toBe(false);
    expect(isAssignable(source, { kind: 'object', fields: { b: string } })).toBe(false);
    expect(isAssignable(source, string)).toBe(false);
  });
});

describe('isTextConvertible', () => {
  it('converts scalars and enums, not objects or lists', () => {
    for (const t of [string, number, boolean, datetime, enumAB]) {
      expect(isTextConvertible(t)).toBe(true);
    }
    expect(isTextConvertible({ kind: 'object', fields: {} })).toBe(false);
    expect(isTextConvertible({ kind: 'list', item: string })).toBe(false);
  });
});

describe('describeType', () => {
  it('prints readable names', () => {
    expect(describeType(string)).toBe('string');
    expect(describeType(enumAB)).toBe('enum<a | b>');
    expect(describeType({ kind: 'list', item: number })).toBe('list<number>');
    expect(describeType({ kind: 'object', fields: { x: number } })).toBe('object<x: number>');
  });
});

describe('FieldTypeSchema', () => {
  it('parses nested types strictly', () => {
    const nested = { kind: 'list', item: { kind: 'object', fields: { a: { kind: 'string' } } } };
    expect(FieldTypeSchema.safeParse(nested).success).toBe(true);
    expect(FieldTypeSchema.safeParse({ kind: 'string', extra: 1 }).success).toBe(false);
    expect(FieldTypeSchema.safeParse({ kind: 'enum', values: [] }).success).toBe(false);
    expect(FieldTypeSchema.safeParse({ kind: 'enum', values: ['a', 'a'] }).success).toBe(false);
    expect(FieldTypeSchema.safeParse({ kind: 'any' }).success).toBe(false);
  });

  it('limits nesting depth', () => {
    let t: unknown = { kind: 'string' };
    for (let i = 0; i < 6; i++) t = { kind: 'list', item: t };
    expect(FieldTypeSchema.safeParse(t).success).toBe(false);
  });
});
