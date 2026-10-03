/**
 * Guards for navigation targets that come from outside the bundle (an API
 * response, a deployment output, a parsed URL). Every redirect / `window.open`
 * sink in the dashboard must only receive a value that passed one of these, so
 * a `javascript:` or `data:` URL can never be navigated to.
 */

/** An absolute http(s) URL. Rejects javascript:, data:, blob: and protocol-relative values. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns the URL when it is http(s), otherwise `null` — for sinks that need a value or a bail-out. */
export function httpUrlOrNull(value: unknown): string | null {
  return isHttpUrl(value) ? value : null;
}
