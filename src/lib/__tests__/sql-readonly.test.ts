import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../db/create";
import { describeSchema, formatTable, openReadOnly, runReadOnlyQuery } from "../sql-readonly";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mycelium-sql-"));
const file = path.join(dir, "test.db");

beforeAll(() => {
  const db = createDb(file); // migrated on disk, like the real app DB
  db.$client.close();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("read-only SQL", () => {
  it("runs SELECTs and CTEs against tables and views", () => {
    const db = openReadOnly(file);
    expect(runReadOnlyQuery(db, "SELECT 1 + 1 AS two;")).toEqual({ columns: ["two"], rows: [{ two: 2 }] });
    expect(runReadOnlyQuery(db, "WITH x AS (SELECT * FROM v_ledger) SELECT count(*) AS n FROM x").rows).toEqual([{ n: 0 }]);
    db.close();
  });

  it("refuses every kind of write", () => {
    const db = openReadOnly(file);
    for (const q of [
      "DELETE FROM transactions",
      "UPDATE accounts SET hidden = 1",
      "INSERT INTO sync_runs (started_at, trigger) VALUES ('x', 'cli')",
      "DROP TABLE transactions",
      "CREATE TABLE evil (x)",
      "ATTACH DATABASE '/tmp/x.db' AS x",
      "PRAGMA journal_mode = DELETE",
    ]) {
      expect(() => runReadOnlyQuery(db, q), q).toThrow();
    }
    expect(() => runReadOnlyQuery(db, "SELECT 1; DELETE FROM transactions")).toThrow();
    db.close();
  });

  it("describes the schema and formats tables", () => {
    const db = openReadOnly(file);
    const schema = describeSchema(db);
    expect(schema).toContain("view: v_ledger");
    expect(schema).toContain("table: transactions");
    expect(schema).not.toContain("__drizzle");
    db.close();
    expect(formatTable({ columns: ["a", "b"], rows: [{ a: 1.234, b: null }] })).toBe("a     b\n----  ----\n1.23  NULL\n(1 row)");
  });
});
