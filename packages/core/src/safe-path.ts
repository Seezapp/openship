/**
 * Path containment.
 *
 * `join(base, segment)` happily walks out of `base` when the segment carries
 * `..` or is absolute. Anywhere a path segment comes from outside the process —
 * a release tag, a project slug, a domain, a file name read from a manifest, a
 * config field — it must be joined through one of these helpers, which resolve
 * the result and refuse anything that lands outside the base directory.
 *
 *   resolveWithin("/var/cache/dist", "v1.2.3")      → "/var/cache/dist/v1.2.3"
 *   resolveWithin("/var/cache/dist", "../etc")      → throws PathEscapeError
 *   resolveWithin("/var/cache/dist", "/etc/passwd") → throws PathEscapeError
 *
 * `resolveWithin` follows the host platform's path rules (local filesystem);
 * `resolveWithinPosix` always uses `/` semantics, for paths on a remote Linux
 * box reached through an executor.
 */

import { posix, resolve as resolveHost, relative as relativeHost, isAbsolute as isAbsoluteHost } from "node:path";

export class PathEscapeError extends Error {
  readonly base: string;
  readonly segments: readonly string[];
  constructor(base: string, segments: readonly string[]) {
    super(`Path escapes ${base}: ${segments.join("/")}`);
    this.name = "PathEscapeError";
    this.base = base;
    this.segments = segments;
  }
}

type PathOps = {
  resolve: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
  isAbsolute: (p: string) => boolean;
};

function within(ops: PathOps, base: string, segments: readonly string[]): string {
  for (const segment of segments) {
    if (typeof segment !== "string" || segment.includes("\0")) {
      throw new PathEscapeError(base, segments);
    }
  }
  const root = ops.resolve(base);
  const target = ops.resolve(root, ...segments);
  const rel = ops.relative(root, target);
  if (rel === "") return target; // the base itself (an empty / "." segment)
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || ops.isAbsolute(rel)) {
    throw new PathEscapeError(base, segments);
  }
  return target;
}

/** Resolve `segments` under `base` on the local filesystem; throws if the result leaves `base`. */
export function resolveWithin(base: string, ...segments: string[]): string {
  return within({ resolve: resolveHost, relative: relativeHost, isAbsolute: isAbsoluteHost }, base, segments);
}

/** Same as {@link resolveWithin}, with POSIX `/` semantics for remote (Linux) paths. */
export function resolveWithinPosix(base: string, ...segments: string[]): string {
  return within({ resolve: posix.resolve, relative: posix.relative, isAbsolute: posix.isAbsolute }, base, segments);
}

/** True when `segments` resolve to a location inside `base` (or `base` itself). */
export function isWithin(base: string, ...segments: string[]): boolean {
  try {
    resolveWithin(base, ...segments);
    return true;
  } catch {
    return false;
  }
}

/**
 * For a path that is by design an arbitrary operator-chosen location (a local
 * backup directory, a source folder, a key file) — there is no base to contain
 * it to, so this only refuses what no real path is (empty, non-string, NUL) and
 * returns it absolute and normalized, with every `.`/`..` segment collapsed.
 */
export function normalizeLocalPath(path: string): string {
  if (typeof path !== "string" || path === "" || path.includes("\0")) {
    throw new PathEscapeError("", [String(path)]);
  }
  return resolveHost(path);
}
