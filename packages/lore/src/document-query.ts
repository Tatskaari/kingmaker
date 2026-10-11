import initSqlJs from "sql.js/dist/sql-asm.js";
import type { Database, SqlValue } from "sql.js";
import type { WorldState } from "../../contracts/src/v2.js";
import type { DocumentQueryResult } from "./service-types.js";

const SCHEMA = `
CREATE TABLE docs (path TEXT PRIMARY KEY, name TEXT, folder TEXT, summary TEXT, body TEXT);
CREATE TABLE props (path TEXT, key TEXT, value);
CREATE TABLE links (source TEXT, target TEXT);
CREATE INDEX props_key ON props (key, path);
CREATE INDEX links_source ON links (source);
CREATE INDEX links_target ON links (target);`;

let engine: ReturnType<typeof initSqlJs> | undefined;
const patterns = new Map<string, RegExp>();
function regex(pattern: string) {
  if (pattern.length > 500) throw new Error("Regex pattern is too long.");
  if (!patterns.has(pattern)) patterns.set(pattern, new RegExp(pattern, "iu"));
  return patterns.get(pattern)!;
}

/** Scalars are stored directly; list items become separate rows; nested values stay as JSON. */
function propValues(value: unknown): SqlValue[] {
  if (Array.isArray(value)) return value.flatMap(propValues);
  if (value === null || typeof value === "string" || typeof value === "number") return [value];
  if (typeof value === "boolean") return [value ? 1 : 0];
  return [JSON.stringify(value)];
}

function load(db: Database, docs: WorldState["docs"], fail: (error: unknown) => never) {
  db.run(SCHEMA);
  // sql.js drops the message of errors thrown by functions; report it through `fail` instead.
  // It also takes the SQL arity from the wrapper's declared parameter count.
  const fn = (name: string, body: (a: SqlValue, b: SqlValue) => SqlValue) =>
    db.create_function(name, (a: SqlValue, b: SqlValue) => { try { return body(a, b); } catch (error) { return fail(error); } });
  fn("regexp", (pattern: SqlValue, text: SqlValue) =>
    typeof pattern === "string" && text !== null ? Number(regex(pattern).test(String(text))) : 0);
  fn("snippets", (body: SqlValue, pattern: SqlValue) => {
    if (typeof body !== "string" || typeof pattern !== "string") return null;
    const matcher = regex(pattern);
    return JSON.stringify(body.split("\n").flatMap((text, index) => matcher.test(text)
      ? [{ line: index + 1, text: text.trim().slice(0, 240) }] : []).slice(0, 5));
  });
  const doc = db.prepare("INSERT INTO docs VALUES (?, ?, ?, ?, ?)");
  const prop = db.prepare("INSERT INTO props VALUES (?, ?, ?)");
  const link = db.prepare("INSERT INTO links VALUES (?, ?)");
  db.run("BEGIN");
  for (const [path, document] of Object.entries(docs)) {
    const slash = path.lastIndexOf("/");
    const summary = document.frontmatter?.summary;
    doc.run([path, path.slice(slash + 1).replace(/\.md$/, ""), path.slice(0, Math.max(slash, 0)),
      typeof summary === "string" ? summary : null, document.body]);
    for (const [key, value] of Object.entries(document.frontmatter ?? {})) {
      for (const item of propValues(value)) prop.run([path, key, item]);
    }
    for (const { target } of document.links) link.run([path, target]);
  }
  db.run("COMMIT");
  for (const statement of [doc, prop, link]) statement.free();
  db.run("PRAGMA query_only = ON");
}

/** Run one read-only SQL statement against a throwaway SQLite view of the live documents. */
export async function queryDocuments(read: () => WorldState["docs"], sql: string, maxRows = 200): Promise<DocumentQueryResult> {
  const SQL = await (engine ??= initSqlJs());
  // Read after initialisation so the snapshot is the world at query time.
  const db = new SQL.Database();
  let failure: unknown;
  try {
    load(db, read(), error => { failure = error; throw error; });
    const statements = db.iterateStatements(sql), first = statements.next();
    if (first.done) throw new Error("Supply one SQL statement.");
    const statement = first.value;
    try {
      if (statements.getRemainingSQL().trim()) throw new Error("Run one SQL statement at a time.");
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) {
        if (rows.length === maxRows) return { columns: statement.getColumnNames(), rows, truncated: true };
        rows.push(statement.getAsObject() as Record<string, SqlValue>);
      }
      return { columns: statement.getColumnNames(), rows, truncated: false };
    } finally { statement.free(); }
  } catch (error) {
    throw failure ?? error;
  } finally { db.close(); }
}
