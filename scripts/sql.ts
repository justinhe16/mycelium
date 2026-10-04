/**
 * Read-only SQL over the Mycelium database, for you and for agents.
 *
 *   npm run sql -- "SELECT kind, round(sum(amount), 2) FROM v_ledger GROUP BY 1"
 *   npm run sql -- --json "SELECT * FROM v_net_worth_daily ORDER BY day DESC LIMIT 7"
 *   npm run sql -- --schema
 *
 * The connection is opened read-only and every statement must be a reader, so
 * nothing run through here can change data.
 */
import "./env";
import path from "node:path";
import { describeSchema, formatTable, openReadOnly, runReadOnlyQuery } from "../src/lib/sql-readonly";

const args = process.argv.slice(2);
const json = args.includes("--json");
const schema = args.includes("--schema");
const query = args.filter((a) => !a.startsWith("--")).join(" ");

const file = process.env.DATABASE_PATH ?? "data/mycelium.db";
const dbPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);

try {
  const db = openReadOnly(dbPath);
  if (schema) {
    console.log(describeSchema(db));
  } else if (!query) {
    console.error('Usage: npm run sql -- [--json] "SELECT ..."   |   npm run sql -- --schema');
    process.exit(1);
  } else {
    const result = runReadOnlyQuery(db, query);
    console.log(json ? JSON.stringify(result.rows, null, 2) : formatTable(result));
  }
  db.close();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
