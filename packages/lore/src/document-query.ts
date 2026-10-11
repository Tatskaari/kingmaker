import type { JsonValue } from "@bufbuild/protobuf";
import { parse, type BinaryOperator, type Expr, type ExprRef, type SelectFromStatement } from "pgsql-ast-parser";
import type { WorldState } from "../../contracts/src/v2.js";
import type { DocumentQueryResult } from "./service-types.js";

type Docs = WorldState["docs"];
type Scalar = string | number | boolean;

function unsupported(what: string): never {
  throw new Error(`Unsupported SQL: ${what}. Select from the single docs table and follow links with IN (SELECT file.path FROM docs WHERE ...).`);
}

const patterns = new Map<string, RegExp>();
function regex(source: string, flags: string) {
  if (source.length > 500) throw new Error("Regex pattern is too long.");
  const key = `${flags}/${source}`;
  if (!patterns.has(key)) patterns.set(key, new RegExp(source, flags));
  return patterns.get(key)!;
}
const like = (pattern: string, flags: string) =>
  regex(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, `su${flags}`);

/** Lists compare item by item; missing values have no items, so comparisons with them are false. */
const items = (value: JsonValue | undefined): Scalar[] => Array.isArray(value) ? value.flatMap(items)
  : value === null || value === undefined ? [] : typeof value === "object" ? [JSON.stringify(value)] : [value];
function order(a: Scalar, b: Scalar) {
  const [x, y] = typeof a === typeof b ? [a, b] : [String(a), String(b)];
  return x < y ? -1 : x > y ? 1 : 0;
}
const operators: Partial<Record<BinaryOperator, (a: Scalar, b: Scalar) => boolean>> = {
  "=": (a, b) => order(a, b) === 0, "!=": (a, b) => order(a, b) !== 0,
  "<": (a, b) => order(a, b) < 0, "<=": (a, b) => order(a, b) <= 0,
  ">": (a, b) => order(a, b) > 0, ">=": (a, b) => order(a, b) >= 0,
  "~": (a, b) => regex(String(b), "u").test(String(a)), "~*": (a, b) => regex(String(b), "iu").test(String(a)),
  LIKE: (a, b) => like(String(b), "").test(String(a)), ILIKE: (a, b) => like(String(b), "i").test(String(a)),
};
const negations: Partial<Record<BinaryOperator, BinaryOperator>> = { "!~": "~", "!~*": "~*", "NOT LIKE": "LIKE", "NOT ILIKE": "ILIKE", "NOT IN": "IN" };

/** Evaluates one parsed SELECT directly over the live documents. Subqueries are uncorrelated, so each runs once. */
class Evaluation {
  #backlinks?: Map<string, string[]>;
  #keys?: Set<string>;
  #subqueries = new Map<SelectFromStatement, Set<Scalar>>();
  constructor(private readonly docs: Docs) {}

  private backlinks() {
    if (!this.#backlinks) {
      this.#backlinks = new Map();
      for (const [path, doc] of Object.entries(this.docs)) for (const { target } of doc.links) {
        if (!this.#backlinks.has(target)) this.#backlinks.set(target, []);
        this.#backlinks.get(target)!.push(path);
      }
    }
    return this.#backlinks;
  }
  /** Bare names are frontmatter properties; file.* names are derived from the document itself. */
  private column(ref: ExprRef, path: string): JsonValue {
    const doc = this.docs[path]!;
    if (ref.table) {
      if (ref.table.name !== "file" || ref.table.schema) unsupported(`qualifier ${ref.table.name}; use file.<field> or a property name`);
      const slash = path.lastIndexOf("/");
      switch (ref.name) {
        case "path": return path;
        case "name": return path.slice(slash + 1).replace(/\.md$/, "");
        case "folder": return path.slice(0, Math.max(slash, 0));
        case "body": return doc.body;
        case "links": return doc.links.map(link => link.target);
        case "backlinks": return this.backlinks().get(path) ?? [];
        default: throw new Error(`Unknown file field: file.${ref.name}. Use path, name, folder, body, links or backlinks.`);
      }
    }
    if (ref.name === "*") unsupported("* outside the select list");
    const frontmatter = doc.frontmatter ?? {}, name = ref.name.toLowerCase();
    const key = Object.hasOwn(frontmatter, ref.name) ? ref.name : Object.keys(frontmatter).find(key => key.toLowerCase() === name);
    if (key !== undefined) return frontmatter[key]!;
    this.#keys ??= new Set(Object.values(this.docs).flatMap(doc => Object.keys(doc.frontmatter ?? {}).map(key => key.toLowerCase())));
    if (!this.#keys.has(name)) throw new Error(`Unknown property: ${ref.name}. File fields need the file. prefix.`);
    return null;
  }
  value(expr: Expr, path: string): JsonValue {
    switch (expr.type) {
      case "string": case "integer": case "numeric": case "boolean": return expr.value;
      case "null": return null;
      case "ref": return this.column(expr, path);
      case "list": case "array": return expr.expressions.map(item => this.value(item, path));
      case "binary": case "unary": return this.test(expr, path);
      case "call": {
        if (expr.function.name !== "snippets" || expr.function.schema || expr.args.length !== 2) unsupported(`function ${expr.function.name}; only snippets(text, pattern) is available`);
        const [text, pattern] = expr.args.map(arg => this.value(arg, path));
        if (typeof text !== "string" || typeof pattern !== "string") return null;
        const matcher = regex(pattern, "iu");
        return text.split("\n").flatMap((line, index) => matcher.test(line)
          ? [{ line: index + 1, text: line.trim().slice(0, 240) }] : []).slice(0, 5);
      }
      default: return unsupported(`${expr.type} expression`);
    }
  }
  test(expr: Expr, path: string): boolean {
    if (expr.type === "unary") {
      if (expr.op === "NOT") return !this.test(expr.operand, path);
      if (expr.op === "IS NULL") return !items(this.value(expr.operand, path)).length;
      if (expr.op === "IS NOT NULL") return items(this.value(expr.operand, path)).length > 0;
      return unsupported(`operator ${expr.op}`);
    }
    if (expr.type !== "binary") return items(this.value(expr, path)).some(item => item === true);
    if (expr.op === "AND") return this.test(expr.left, path) && this.test(expr.right, path);
    if (expr.op === "OR") return this.test(expr.left, path) || this.test(expr.right, path);
    const op = negations[expr.op] ?? expr.op, left = items(this.value(expr.left, path));
    let result: boolean;
    if (op === "IN") {
      // A single parenthesised value parses as that value rather than a one-item list.
      const right = expr.right.type === "select" ? this.subquery(expr.right) : new Set(items(this.value(expr.right, path)));
      result = left.some(item => right.has(item));
    } else {
      const compare = operators[op] ?? unsupported(`operator ${op}`), right = items(this.value(expr.right, path));
      result = left.some(a => right.some(b => compare(a, b)));
    }
    return op === expr.op ? result : !result;
  }
  private subquery(statement: SelectFromStatement) {
    if (!this.#subqueries.has(statement)) {
      const [column] = statement.columns ?? [];
      if (statement.columns?.length !== 1 || (column!.expr.type === "ref" && column!.expr.name === "*")) unsupported("IN subqueries must select one column");
      this.#subqueries.set(statement, new Set(this.paths(statement).flatMap(path => items(this.value(column!.expr, path)))));
    }
    return this.#subqueries.get(statement)!;
  }
  paths(statement: SelectFromStatement) {
    const [from, ...joins] = statement.from ?? [];
    if (!from || joins.length || from.type !== "table" || from.join || from.name.name !== "docs" || from.name.schema || from.name.alias) unsupported("FROM must be exactly docs, without joins or aliases");
    for (const clause of ["groupBy", "having", "distinct", "for", "skip"] as const) if (statement[clause]) unsupported(clause);
    const paths = Object.keys(this.docs).sort().filter(path => !statement.where || this.test(statement.where, path));
    if (statement.orderBy?.length) {
      const keys = new Map(paths.map(path => [path, statement.orderBy!.map(({ by }) => items(this.value(by, path))[0])]));
      paths.sort((a, b) => {
        for (const [index, { order: direction, nulls }] of statement.orderBy!.entries()) {
          const x = keys.get(a)![index], y = keys.get(b)![index];
          const result = x === undefined || y === undefined ? (x === y ? 0 : (x === undefined) === (nulls !== "FIRST") ? 1 : -1)
            : order(x, y) * (direction === "DESC" ? -1 : 1);
          if (result) return result;
        }
        return 0;
      });
    }
    const bound = (expr: Expr | null | undefined, fallback: number) => {
      if (!expr) return fallback;
      if (expr.type !== "integer" || expr.value < 0) unsupported("LIMIT and OFFSET must be non-negative integers");
      return expr.value;
    };
    const offset = bound(statement.limit?.offset, 0);
    return paths.slice(offset, offset + bound(statement.limit?.limit, paths.length));
  }
}

/** Parse one read-only SELECT and interpret it against the live documents without copying them. */
export async function queryDocuments(read: () => Docs, sql: string, maxRows = 200): Promise<DocumentQueryResult> {
  let statements;
  try { statements = parse(sql); } catch (error) { throw new Error(`Invalid SQL: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`); }
  if (statements.length !== 1) throw new Error("Run one SQL statement at a time.");
  const statement = statements[0]!;
  if (statement.type !== "select") unsupported(`${statement.type} statements; queries are read-only SELECTs`);
  const docs = read(), evaluation = new Evaluation(docs), paths = evaluation.paths(statement);
  const columns = new Set<string>(), rows = paths.slice(0, maxRows).map(path => {
    const row: Record<string, JsonValue> = {};
    for (const [index, { expr, alias }] of (statement.columns ?? []).entries()) {
      if (expr.type === "ref" && expr.name === "*" && !expr.table) {
        row["file.path"] = path;
        Object.assign(row, docs[path]!.frontmatter ?? {});
      } else {
        const name = alias?.name ?? (expr.type === "ref" ? (expr.table ? `${expr.table.name}.${expr.name}` : expr.name)
          : expr.type === "call" ? expr.function.name : `column${index + 1}`);
        row[name] = evaluation.value(expr, path);
      }
    }
    for (const name of Object.keys(row)) columns.add(name);
    return row;
  });
  return { columns: [...columns], rows, truncated: paths.length > maxRows };
}
