import { describe, expect, test } from 'bun:test';
import { isHttpUrl, isSafeRelativePath } from './safe-url';

describe('isSafeRelativePath', () => {
  test('accepts same-origin paths', () => {
    for (const path of ['/', '/login', '/mail/inbox?x=1#y']) {
      expect(isSafeRelativePath(path)).toBe(true);
    }
  });

  test('rejects anything that can leave the origin or run script', () => {
    for (const value of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'login',
      '',
      '/a\r\nb',
      null,
      undefined,
    ]) {
      expect(isSafeRelativePath(value)).toBe(false);
    }
  });
});

describe('isHttpUrl', () => {
  test('accepts only absolute http(s) URLs', () => {
    expect(isHttpUrl('https://example.com/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,x')).toBe(false);
    expect(isHttpUrl('/relative')).toBe(false);
  });
});
