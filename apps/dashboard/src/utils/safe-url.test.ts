import { describe, expect, it } from "vitest";

import { httpUrlOrNull, isHttpUrl } from "./safe-url";

describe("isHttpUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isHttpUrl("https://checkout.stripe.com/c/pay/cs_test_1?x=1#y")).toBe(true);
    expect(isHttpUrl("http://localhost:3000/cb")).toBe(true);
    expect(isHttpUrl("HTTPS://Example.com")).toBe(true);
  });

  it("rejects script-bearing, relative and non-string values", () => {
    for (const value of [
      "javascript:alert(1)",
      " javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.com/uuid",
      "vbscript:x",
      "//evil.example/path",
      "/relative",
      "",
      undefined,
      null,
      42,
      { toString: () => "https://example.com" },
    ]) {
      expect(isHttpUrl(value), String(value)).toBe(false);
    }
  });
});

describe("httpUrlOrNull", () => {
  it("returns the URL unchanged, or null", () => {
    expect(httpUrlOrNull("https://example.com/a")).toBe("https://example.com/a");
    expect(httpUrlOrNull("javascript:alert(1)")).toBeNull();
  });
});
