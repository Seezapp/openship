import { describe, expect, it } from "vitest";
import { PathEscapeError, isWithin, normalizeLocalPath, resolveWithin, resolveWithinPosix } from "./safe-path";

describe("resolveWithin", () => {
  it("joins plain segments under the base", () => {
    expect(resolveWithin("/var/cache/dist", "v1.2.3")).toBe("/var/cache/dist/v1.2.3");
    expect(resolveWithin("/var/cache/dist", "a", "b.json")).toBe("/var/cache/dist/a/b.json");
  });

  it("returns the base for an empty segment", () => {
    expect(resolveWithin("/srv/app", "")).toBe("/srv/app");
    expect(resolveWithin("/srv/app")).toBe("/srv/app");
  });

  it("refuses dot-segment and absolute escapes", () => {
    expect(() => resolveWithin("/var/cache/dist", "../etc")).toThrow(PathEscapeError);
    expect(() => resolveWithin("/var/cache/dist", "..")).toThrow(PathEscapeError);
    expect(() => resolveWithin("/var/cache/dist", "x/../../etc/passwd")).toThrow(PathEscapeError);
    expect(() => resolveWithin("/var/cache/dist", "/etc/passwd")).toThrow(PathEscapeError);
    expect(() => resolveWithin("/var/cache/dist", "v1\0")).toThrow(PathEscapeError);
  });

  it("does not treat a sibling with a shared prefix as inside", () => {
    expect(() => resolveWithin("/var/cache/dist", "../dist-evil/x")).toThrow(PathEscapeError);
  });

  it("isWithin mirrors the throw", () => {
    expect(isWithin("/srv", "ok")).toBe(true);
    expect(isWithin("/srv", "../no")).toBe(false);
  });
});

describe("resolveWithinPosix", () => {
  it("uses / semantics regardless of host", () => {
    expect(resolveWithinPosix("/etc/nginx/sites", "app.conf")).toBe("/etc/nginx/sites/app.conf");
    expect(() => resolveWithinPosix("/etc/nginx/sites", "../nginx.conf")).toThrow(PathEscapeError);
    expect(() => resolveWithinPosix("/etc/letsencrypt/live", "../../root/.ssh")).toThrow(PathEscapeError);
  });
});

describe("normalizeLocalPath", () => {
  it("returns an absolute, normalized path", () => {
    expect(normalizeLocalPath("/srv/app/../backups/./a")).toBe("/srv/backups/a");
  });

  it("refuses an empty path and NUL bytes", () => {
    expect(() => normalizeLocalPath("")).toThrow(PathEscapeError);
    expect(() => normalizeLocalPath("/srv/a\0b")).toThrow(PathEscapeError);
  });
});
