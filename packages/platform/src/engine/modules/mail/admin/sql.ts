/**
 * Parameterized SQL for the mail admin psql runner.
 *
 * `sql\`…\`` captures every interpolated value as a BIND PARAMETER instead of
 * splicing it into the statement. The runner streams the statement text to psql
 * on stdin and hands the values over as `-v` variables, so psql substitutes each
 * `:'vN'` reference as a correctly quoted literal and the statement text never
 * contains user data. Identifiers (tables, columns) stay hard-coded in the
 * service files; `sqlRaw` exists only for those static fragments.
 *
 *   sql`SELECT 1 FROM mailbox WHERE username = ${email}`
 *     → text:   SELECT 1 FROM mailbox WHERE username = :'v0'
 *       params: ["alice@example.com"]
 *
 * Numbers are inlined as validated integer literals (a number cannot carry an
 * injection), booleans as TRUE/FALSE, null/undefined as NULL. Nested queries
 * compose: `sql`… ${sqlJoin(parts, ", ")} …`` renumbers their parameters.
 *
 * The statement text is read by psql, so keep it free of backslash
 * meta-commands and of `:name` sequences other than the generated references
 * (`::type` casts are fine).
 *
 * This module is pure — no I/O, no transitive engine imports — so tests can use
 * the real builder while mocking the runner.
 */

const BRAND = Symbol.for("openship.mail.sql-query");

type Segment = string | { readonly param: string };

export interface SqlQuery {
  readonly [BRAND]: true;
  /** Statement text with `:'vN'` psql variable references in place of every value. */
  readonly text: string;
  /** Bind values in order: `params[N]` is what `:'vN'` resolves to. */
  readonly params: readonly string[];
  /** The statement with every value inlined as a quoted literal. For logs and tests — never executed. */
  toString(): string;
}

export type SqlValue = string | number | boolean | null | undefined | SqlQuery;

class Query implements SqlQuery {
  readonly [BRAND] = true as const;
  constructor(readonly segments: readonly Segment[]) {}

  get text(): string {
    let n = 0;
    return this.segments.map((s) => (typeof s === "string" ? s : `:'v${n++}'`)).join("");
  }

  get params(): string[] {
    const out: string[] = [];
    for (const s of this.segments) if (typeof s !== "string") out.push(s.param);
    return out;
  }

  toString(): string {
    return this.segments.map((s) => (typeof s === "string" ? s : quoteLiteral(s.param))).join("");
  }
}

export function isSqlQuery(value: unknown): value is SqlQuery {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
}

/**
 * Quote a value as a PostgreSQL string literal (`'` → `''`). Only used for the
 * debug rendering; the runner binds parameters through psql variables instead.
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Render an integer literal. Truncates floats and rejects NaN / Infinity so a
 * non-finite number can never reach the statement text.
 */
export function sqlInt(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`sqlInt refused non-finite value: ${value}`);
  }
  const int = Math.trunc(value);
  // Beyond 2^53 String() switches to exponent notation, which is not an integer literal.
  if (!Number.isSafeInteger(int)) {
    throw new Error(`sqlInt refused out-of-range value: ${value}`);
  }
  return String(int);
}

function segmentsOf(value: SqlValue): readonly Segment[] {
  if (isSqlQuery(value)) return (value as Query).segments;
  if (value === null || value === undefined) return ["NULL"];
  if (typeof value === "string") {
    // A NUL cannot travel in an argv (or a PostgreSQL text value) — refuse it
    // here instead of letting the shell silently truncate the parameter.
    if (value.includes("\0")) throw new Error("SQL parameter contains a NUL byte");
    return [{ param: value }];
  }
  if (typeof value === "number") return [sqlInt(value)];
  if (typeof value === "boolean") return [value ? "TRUE" : "FALSE"];
  throw new TypeError(`Unsupported SQL value of type ${typeof value}`);
}

/** Tagged template: every `${value}` becomes a bind parameter (or a nested query). */
export function sql(strings: TemplateStringsArray, ...values: SqlValue[]): SqlQuery {
  const segments: Segment[] = [];
  strings.forEach((chunk, i) => {
    segments.push(chunk);
    if (i < values.length) segments.push(...segmentsOf(values[i]));
  });
  return new Query(segments);
}

/**
 * A trusted, STATIC fragment (a hard-coded column list, a keyword). Never pass
 * anything derived from input here — use `sql` so it is bound instead.
 */
export function sqlRaw(text: string): SqlQuery {
  return new Query([text]);
}

/** Join queries with a static separator, keeping every parameter bound. */
export function sqlJoin(parts: readonly SqlQuery[], separator = ", "): SqlQuery {
  const segments: Segment[] = [];
  parts.forEach((part, i) => {
    if (i > 0) segments.push(separator);
    segments.push(...(part as Query).segments);
  });
  return new Query(segments);
}

/** Name the bind parameters the way the statement text references them (`v0`, `v1`, …). */
export function sqlBindings(query: SqlQuery): Record<string, string> {
  const out: Record<string, string> = {};
  query.params.forEach((value, i) => {
    out[`v${i}`] = value;
  });
  return out;
}
