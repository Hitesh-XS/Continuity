import { describe, expect, it } from 'vitest';
import { apiMatchPattern, apiOrigin, assertSafeBaseUrl } from '../src/shared/api-config';

describe('assertSafeBaseUrl', () => {
  it.each(['https://api.example.com', 'http://localhost:8000', 'http://127.0.0.1:8000'])(
    'accepts %s',
    (url) => {
      expect(() => assertSafeBaseUrl(url)).not.toThrow();
    },
  );

  it.each([
    'http://api.example.com',
    'ftp://127.0.0.1',
    'not a url',
    'http://127.0.0.1.evil.example',
  ])('rejects %s', (url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow();
  });
});

describe('api config helpers', () => {
  it('returns the origin without a path', () => {
    expect(apiOrigin('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000');
  });

  it.each([
    ['http://127.0.0.1:8000', 'http://127.0.0.1/*'],
    ['https://api.example.com:8443/x', 'https://api.example.com/*'],
  ])('builds a match pattern for %s', (base, expected) => {
    expect(apiMatchPattern(base)).toBe(expected);
  });
});