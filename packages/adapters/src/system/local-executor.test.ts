import { describe, expect, it } from "vitest";
import { LocalExecutor } from "./local-executor";
import { sq } from "./local-shell";

const posix = process.platform !== "win32";

describe.runIf(posix)("LocalExecutor.exec", () => {
  const executor = new LocalExecutor();

  it("resolves trimmed stdout", async () => {
    await expect(executor.exec("printf '  hello \\n'")).resolves.toBe("hello");
  });

  it("rejects on non-zero exit with both streams folded into the error", async () => {
    await expect(executor.exec("echo cause; echo boiler >&2; exit 3")).rejects.toThrow(
      /boiler\ncause/,
    );
  });

  it("keeps a quoted value literal even when it carries shell metacharacters", async () => {
    const hostile = "x; echo INJECTED $(id) `id` && touch /tmp/nope";
    await expect(executor.exec(`printf '%s' ${sq(hostile)}`)).resolves.toBe(hostile);
  });

  it("honours the timeout", async () => {
    await expect(executor.exec("sleep 5", { timeout: 200 })).rejects.toThrow();
  });
});
