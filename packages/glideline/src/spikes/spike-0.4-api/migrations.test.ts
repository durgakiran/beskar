import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { migrateRecord, migrateRecordDown, GlideSchema } from "../../schema.js";
import { defineMigrations, T } from "./types.js";

const boxMigrations = defineMigrations({
  currentVersion: 3,
  migrators: {
    1: { up: (r) => ({ ...r, props: { ...(r.props as any), opacity: 1 } }),       down: (r) => { const { opacity: _, ...rest } = (r.props as any); return { ...r, props: rest }; } },
    2: { up: (r) => ({ ...r, props: { ...(r.props as any), cornerRadius: 0 } }), down: (r) => { const { cornerRadius: _, ...rest } = (r.props as any); return { ...r, props: rest }; } },
    3: { up: (r) => ({ ...r, props: { ...(r.props as any), locked: false } }),    down: (r) => { const { locked: _, ...rest } = (r.props as any); return { ...r, props: rest }; } },
  }
});

// ─────────────────────────────────────────────────────────────

describe("migrateRecord", () => {
  it("v0 → v3: applies all three up() migrators", () => {
    const old = { id: "s1", type: "box", props: { w: 100, h: 80 } };
    const result = migrateRecord(old, boxMigrations, 0);
    assert.deepEqual((result as any).props, { w: 100, h: 80, opacity: 1, cornerRadius: 0, locked: false });
  });

  it("v2 → v3: applies only missing migrator", () => {
    const old = { id: "s1", type: "box", props: { w: 100, opacity: 1, cornerRadius: 0 } };
    const result = migrateRecord(old, boxMigrations, 2);
    assert.deepEqual((result as any).props, { w: 100, opacity: 1, cornerRadius: 0, locked: false });
  });

  it("already at currentVersion: returns unchanged", () => {
    const fresh = { id: "s1", type: "box", props: { w: 100, opacity: 1, cornerRadius: 0, locked: false } };
    const result = migrateRecord(fresh, boxMigrations, 3);
    assert.deepEqual((result as any).props, fresh.props);
  });
});

describe("migrateRecordDown", () => {
  it("v3 → v1: reverses two migrators", () => {
    const current = { id: "s1", type: "box", props: { w: 100, opacity: 1, cornerRadius: 0, locked: false } };
    const result = migrateRecordDown(current, boxMigrations, 3, 1);
    assert.deepEqual((result as any).props, { w: 100, opacity: 1 });
  });
});

describe("GlideSchema.load", () => {
  it("runs migrators based on saved version header", () => {
    class FakeBoxUtil { static type = "box"; static migrations = boxMigrations; }
    const schema = new GlideSchema();
    schema.registerShapeUtil(FakeBoxUtil as any);

    const doc = {
      schema: { storeVersion: 1, shapes: { box: 1 }, bindings: {} },
      records: [{ id: "s1", type: "box", props: { w: 100, opacity: 1 } }],
    };

    const records = schema.load(doc as any);
    assert.deepEqual((records[0] as any).props, { w: 100, opacity: 1, cornerRadius: 0, locked: false });
  });

  it("unknown types preserved without crashing", () => {
    const schema = new GlideSchema(); // No utils registered
    const doc = {
      schema: { storeVersion: 1, shapes: {}, bindings: {} },
      records: [{ id: "s1", type: "my-unknown-plugin-shape", props: { someField: 42 } }],
    };
    const records = schema.load(doc as any);
    assert.equal(records.length, 1);
    assert.equal((records[0] as any).type, "my-unknown-plugin-shape");
    assert.equal((records[0] as any).props.someField, 42);
  });

  it("future record (savedVersion > currentVersion) preserved without crash", () => {
    class FakeBoxUtil { static type = "box"; static migrations = boxMigrations; }
    const schema = new GlideSchema();
    schema.registerShapeUtil(FakeBoxUtil as any);

    const doc = {
      schema: { storeVersion: 1, shapes: { box: 99 }, bindings: {} }, // v99 > v3
      records: [{ id: "s1", type: "box", props: { w: 100, futureField: "hi" } }],
    };
    const records = schema.load(doc as any);
    assert.equal((records[0] as any).props.futureField, "hi");
  });
});

describe("defineMigrations validation", () => {
  it("throws on non-contiguous version sequence", () => {
    assert.throws(() => defineMigrations({
      currentVersion: 2,
      migrators: { 2: { up: r => r, down: r => r } }, // missing 1
    }), /contiguous/);
  });

  it("throws if last migrator version !== currentVersion", () => {
    assert.throws(() => defineMigrations({
      currentVersion: 3,
      migrators: { 1: { up: r => r, down: r => r }, 2: { up: r => r, down: r => r } },
    }), /currentVersion/);
  });
});

describe("T validators", () => {
  it("T.number validates correctly", () => {
    assert.equal(T.number.validate(42), 42);
    assert.throws(() => T.number.validate("hello"), /Expected number/);
  });

  it("T.string validates correctly", () => {
    assert.equal(T.string.validate("hi"), "hi");
    assert.throws(() => T.string.validate(123), /Expected string/);
  });

  it("T.optional allows undefined, delegates otherwise", () => {
    const opt = T.optional(T.number);
    assert.equal(opt.validate(undefined), undefined);
    assert.equal(opt.validate(5), 5);
    assert.throws(() => opt.validate("x"), /Expected number/);
  });

  it("T.union matches first valid candidate", () => {
    const strOrNum = T.union<string | number>(T.string, T.number);
    assert.equal(strOrNum.validate("hello"), "hello");
    assert.equal(strOrNum.validate(42), 42);
    assert.throws(() => strOrNum.validate(true), /union member/);
  });
});
