import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));
import { run, versionOf, versionOfExecutable } from "./execute";

beforeEach(() => {
  spawnSync.mockReset();
  spawnSync.mockReturnValue({ status: 0, stdout: "1.2.3\n", stderr: "" });
});

describe("package-manager execute: argv-only tool launches", () => {
  it("launches tools by allowlisted name without a shell", () => {
    expect(run("corepack", ["prepare", "pnpm@9.15.9", "--activate"])).toBe(true);
    const [file, args, options] = spawnSync.mock.calls[0]!;
    expect(file).toBe("corepack");
    expect(args).toEqual(["prepare", "pnpm@9.15.9", "--activate"]);
    expect(options).toMatchObject({ shell: false, stdio: "inherit" });
    expect(options.env).toMatchObject({
      COREPACK_DEFAULT_TO_LATEST: "0",
      COREPACK_ENABLE_AUTO_PIN: "0",
    });
  });

  it("maps the node tool to the running executable", () => {
    expect(versionOf("node", ["/repo/.yarn/releases/yarn-3.8.7.cjs", "--version"])).toBe("1.2.3");
    const [file, args, options] = spawnSync.mock.calls[0]!;
    expect(file).toBe(process.execPath);
    expect(args).toEqual(["/repo/.yarn/releases/yarn-3.8.7.cjs", "--version"]);
    expect(options).toMatchObject({ shell: false, stdio: "pipe" });
  });

  it("passes shell metacharacters through as literal argv entries", () => {
    run("npm", ["install", "--global", "pnpm@9.15.9; rm -rf /"]);
    expect(spawnSync.mock.calls[0]![1]).toEqual(["install", "--global", "pnpm@9.15.9; rm -rf /"]);
    expect(spawnSync.mock.calls[0]![2]).toMatchObject({ shell: false });
  });

  it("reports a failed or missing tool as no version", () => {
    spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "not found" });
    expect(versionOf("bun")).toBeUndefined();
    spawnSync.mockReturnValue({ status: null, stdout: "", stderr: "", error: new Error("ENOENT") });
    expect(run("npm", ["--version"])).toBe(false);
  });

  it("only runs a downloaded binary from an absolute path", () => {
    expect(versionOfExecutable("/tmp/openship-bun/node_modules/@oven/bun-linux-x64/bin/bun")).toBe(
      "1.2.3",
    );
    expect(spawnSync.mock.calls[0]![0]).toBe(
      "/tmp/openship-bun/node_modules/@oven/bun-linux-x64/bin/bun",
    );
    expect(() => versionOfExecutable("bun")).toThrow("absolute");
    expect(() => versionOfExecutable("node_modules/.bin/bun")).toThrow("absolute");
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
});
