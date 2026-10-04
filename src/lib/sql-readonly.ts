import Database from "better-sqlite3";

/*
 * The agent-facing SQL path. Two independent guards: the connection is opened
 * read-only (SQLite itself refuses writes), and each statement must be one that
 * returns rows and doesn't write.
 */

export function openReadOnly(file: string): Database.Database {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

export type QueryResult = { columns: string[]; rows: Record<string, unknown>[] };

export function runReadOnlyQuery(db: Database.Database, query: string): QueryResult {
  const text = query.trim().replace(/;\s*$/, "");
  if (!text) throw new Error("Empty query.");
  const stmt = db.prepare(text); // prepare() rejects multiple statements
  if (!stmt.reader || !stmt.readonly) {
    throw new Error("Only read-only queries (SELECT / WITH / read-only PRAGMA) are allowed.");
  }
  const rows = stmt.all() as Record<string, unknown>[];
  return { columns: stmt.columns().map((c) => c.name), rows };
}

/** Tables and views with their CREATE statements, for `npm run sql -- --schema`. */
export function describeSchema(db: Database.Database): string {
  const rows = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'
       ORDER BY type DESC, name`,
    )
    .all() as { type: string; name: string; sql: string }[];
  return rows.map((r) => `-- ${r.type}: ${r.name}\n${r.sql};`).join("\n\n");
}

export function formatTable({ columns, rows }: QueryResult, maxWidth = 48): string {
  if (columns.length === 0) return "(no columns)";
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "NULL" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v);
    return s.length > maxWidth ? `${s.slice(0, maxWidth - 1)}…` : s;
  };
  const body = rows.map((r) => columns.map((c) => cell(r[c])));
  const widths = columns.map((c, i) => Math.max(c.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...body.map(line), `(${rows.length} row${rows.length === 1 ? "" : "s"})`].join("\n");
}
