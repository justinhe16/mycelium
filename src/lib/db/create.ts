import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Open a database at `file` and apply pending migrations. Pass ":memory:" for an
 * isolated, fully-migrated DB in tests (migrations resolve from the cwd, which is
 * the repo root under vitest).
 *
 * Lives apart from `index.ts` on purpose: importing that module opens the real
 * app database as a side effect, which tests must never do.
 */
export function createDb(file: string): Db {
  const inMemory = file === ":memory:";
  // Financial data: owner-only directory and files (the default umask leaves them world-readable).
  if (!inMemory) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  const sqlite = new Database(file);
  // WAL keeps reads non-blocking during ingest writes and survives crashes cleanly.
  // (Not applicable to in-memory databases.)
  if (!inMemory) sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  // Zero deleted content instead of leaving it in free pages (e.g. after disconnecting a login).
  sqlite.pragma("secure_delete = ON");
  if (!inMemory) restrictPermissions(file);

  const db = drizzle(sqlite, { schema }) as Db;

  // Apply any pending migrations at boot so a fresh clone (or a restored
  // backup from an older schema) is immediately usable.
  if (fs.existsSync(MIGRATIONS_FOLDER)) {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  }

  return db;
}

/** chmod the DB and its WAL/SHM sidecars to owner-only. Best effort. */
export function restrictPermissions(file: string) {
  try {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
  } catch {
    // Not fatal (e.g. a read-only mount); the app still works.
  }
}
