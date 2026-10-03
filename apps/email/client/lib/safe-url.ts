/**
 * Guards for navigation targets that arrive from outside the bundle (response
 * headers, parsed mail headers). Redirect sinks must only ever receive a value
 * that passed one of these.
 */

/** An absolute http(s) URL — never javascript:, data:, or a protocol-relative value. */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A same-origin path for an in-app redirect: starts with a single "/" (so no
 * "//evil.example" or scheme), and contains no CR/LF or backslash tricks.
 */
export function isSafeRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\') &&
    !/[\r\n]/.test(value)
  );
}
