/**
 * Regression guard for SQL injection in the mail-admin psql path.
 *
 * A statement built with the `sql` tag must reach psql with NO value in its
 * text: every interpolation becomes a `:'vN'` reference, the statement goes to
 * psql on stdin (psql does not interpolate variables in `-c` commands), and
 * each value is its own shell-quoted `-v vN=…` argv that psql substitutes as an
 * escaped literal.
 */

import "./_setup-env"; // MUST be first — sets INTERNAL_TOKEN before config/env loads
import { describe, expect, test } from "vitest";
import type { CommandExecutor } from "@repo/adapters";
import { execute, queryRows, transaction } from "@repo/platform/engine/modules/mail/admin/psql-runner";
import { sql, sqlJoin, sqlRaw } from "@repo/platform/engine/modules/mail/admin/sql";
import { mailPsqlCommand } from "@repo/platform/engine/modules/mail/mail-engine";

function capturingExecutor(sink: string[], output = ""): CommandExecutor {
  return {
    exec: async (cmd: string) => {
      // Answer the topology probe as a live container engine (see psql-injection.test.ts).
      if (cmd.includes("{{.Config.Image}}")) return "true\topenship/mail:latest";
      sink.push(cmd);
      return output;
    },
  } as unknown as CommandExecutor;
}

const EVIL = "x'; DROP TABLE mailbox; --";

describe("sql tag — values are parameters, never statement text", () => {
  test("strings become :'vN' references in order", () => {
    const q = sql`SELECT 1 FROM mailbox WHERE username = ${EVIL} AND domain = ${"b.com"}`;
    expect(q.text).toBe("SELECT 1 FROM mailbox WHERE username = :'v0' AND domain = :'v1'");
    expect(q.params).toEqual([EVIL, "b.com"]);
    expect(q.text).not.toContain("DROP");
  });

  test("nested queries and joins renumber their parameters", () => {
    const sets = [sql`name = ${"A"}`, sql`quota = ${5}`, sql`password = ${"h"}`];
    const q = sql`UPDATE mailbox SET ${sqlJoin(sets, ", ")} WHERE username = ${"u@b.com"}`;
    expect(q.text).toBe("UPDATE mailbox SET name = :'v0', quota = 5, password = :'v1' WHERE username = :'v2'");
    expect(q.params).toEqual(["A", "h", "u@b.com"]);
  });

  test("numbers are validated integer literals; null and booleans are keywords", () => {
    expect(sql`${7.9} ${true} ${null}`.text).toBe("7 TRUE NULL");
    expect(() => sql`${Number.NaN}`).toThrow(/non-finite/);
    expect(() => sql`${1e21}`).toThrow(/out-of-range/);
  });

  test("a NUL byte is refused rather than truncated by the shell", () => {
    expect(() => sql`SELECT ${"a\0b"}`).toThrow(/NUL/);
  });

  test("toString() renders the debug form with doubled quotes", () => {
    expect(String(sql`SELECT ${"o'malley"}`)).toBe("SELECT 'o''malley'");
    expect(sqlRaw("a, b").params).toEqual([]);
  });
});

describe("mailPsqlCommand — bound queries", () => {
  const q = sql`DELETE FROM mailbox WHERE username = ${EVIL}`;

  test("container: statement on stdin, value as one shell-quoted -v argv", () => {
    expect(mailPsqlCommand("container", q)).toBe(
      `printf '%s' 'DELETE FROM mailbox WHERE username = :'\\''v0'\\''' | ` +
        `docker exec -i openship-mail-db psql -U postgres -d vmail -A -t -v ON_ERROR_STOP=1 -X -1 ` +
        `-v 'v0=x'\\''; DROP TABLE mailbox; --'`,
    );
  });

  test("host: same statement and bindings behind sudo -u postgres", () => {
    const cmd = mailPsqlCommand("host", q);
    expect(cmd).toContain("| sudo -u postgres psql -d vmail -A -t -v ON_ERROR_STOP=1 -X -1 -v 'v0=");
    expect(cmd).not.toContain("docker");
  });

  test("never uses -c for a bound query (psql would not substitute the variables)", () => {
    expect(mailPsqlCommand("container", q)).not.toContain(" -c ");
  });

  test("shell metacharacters in a value stay inside its single-quoted argv", () => {
    const cmd = mailPsqlCommand("container", sql`SELECT ${"$(id) `id` \n; rm -rf /"}`);
    expect(cmd.endsWith("-v 'v0=$(id) `id` \n; rm -rf /'")).toBe(true);
  });
});

describe("psql-runner — bound path end to end", () => {
  test("queryRows wraps the SELECT and keeps its parameters bound", async () => {
    const cmds: string[] = [];
    const rows = await queryRows<{ a: number }>(
      capturingExecutor(cmds, '[{"a":1}]'),
      sql`SELECT 1 AS a FROM mailbox WHERE username = ${EVIL}`,
    );
    expect(rows).toEqual([{ a: 1 }]);
    expect(cmds).toHaveLength(1);
    const [statement, psql] = cmds[0].split(" | ");
    expect(statement).toContain("FROM (SELECT 1 AS a FROM mailbox WHERE username = :'\\''v0'\\'') __t");
    expect(statement).not.toContain("DROP");
    expect(psql).toContain("-v 'v0=x'\\''; DROP TABLE mailbox; --'");
  });

  test("execute sends no value in the statement", async () => {
    const cmds: string[] = [];
    await execute(capturingExecutor(cmds), sql`DELETE FROM mailbox WHERE username = ${EVIL}`);
    expect(cmds[0].split(" | ")[0]).toBe(`printf '%s' 'DELETE FROM mailbox WHERE username = :'\\''v0'\\'''`);
  });

  test("transaction runs every statement in one psql -1 invocation with renumbered bindings", async () => {
    const cmds: string[] = [];
    await transaction(capturingExecutor(cmds), [
      sql`DELETE FROM forwardings WHERE address = ${"a@b.com"}`,
      sql`DELETE FROM mailbox WHERE username = ${EVIL};`,
    ]);
    expect(cmds).toHaveLength(1);
    const [statement, psql] = cmds[0].split(" | ");
    expect(statement).toBe(
      `printf '%s' 'DELETE FROM forwardings WHERE address = :'\\''v0'\\'';\nDELETE FROM mailbox WHERE username = :'\\''v1'\\'';'`,
    );
    expect(psql).toContain(" -1 ");
    expect(psql).toContain("-v 'v0=a@b.com' -v 'v1=x'\\''; DROP TABLE mailbox; --'");
    // psql -1 owns the transaction; an explicit BEGIN inside it would only warn.
    expect(statement).not.toContain("BEGIN");
  });
});
