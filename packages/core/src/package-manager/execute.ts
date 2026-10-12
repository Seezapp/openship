import * as cp from "node:child_process";
import * as path from "node:path";

/**
 * The only executables the bootstrap ever launches. Callers pick a tool by name; the
 * binary is never assembled from repository input (package.json, .yarnrc, lockfiles),
 * which is the untrusted data this module runs on behalf of.
 */
const TOOL_BINARIES = {
  npm: "npm",
  pnpm: "pnpm",
  yarn: "yarn",
  bun: "bun",
  corepack: "corepack",
  node: process.execPath,
} as const;
export type Tool = keyof typeof TOOL_BINARIES;

const toolEnv = { ...process.env, COREPACK_DEFAULT_TO_LATEST: "0", COREPACK_ENABLE_AUTO_PIN: "0" };

/** argv-only launch: `shell: false` so arguments are passed verbatim and never parsed. */
const execute = (file: string, args: readonly string[], capture = false) =>
  cp.spawnSync(file, [...args], {
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: toolEnv,
    shell: false,
    windowsHide: true,
  });

const version = (file: string, args: readonly string[]) => {
  const result = execute(file, args, true);
  return result.status === 0 ? result.stdout.trim() : undefined;
};

export const run = (tool: Tool, args: string[]) => execute(TOOL_BINARIES[tool], args).status === 0;
export const versionOf = (tool: Tool, args: string[] = ["--version"]) =>
  version(TOOL_BINARIES[tool], args);

/**
 * Version of a binary the bootstrap downloaded itself (the staged Bun release). The
 * path must be absolute so PATH lookup can never substitute a different executable.
 */
export const versionOfExecutable = (file: string, args: string[] = ["--version"]) => {
  if (!path.isAbsolute(file)) throw new Error("Executable path must be absolute: " + file);
  return version(file, args);
};
